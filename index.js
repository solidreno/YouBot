const fs = require('fs');
const path = require('path');
const spawnSync = require('child_process').spawnSync;
const sanitize = require('sanitize-filename');
const fetch = require('node-fetch');
const xml2js = require('xml2js');
const parser = new xml2js.Parser();

const lastRunFile = __dirname + '/data/lastRun';
const lastRun = getLastRunDate();
const runDate = new Date();
const runDateString = runDate.toISOString();
let inputFile = path.join(__dirname, 'data', 'subscription_manager.xml');
// let basePath = path.join(__dirname, 'videos');
let basePath = path.join(__dirname, 'videos');
let outputDir = '';
// let channelList = [];

initOutputDir(basePath)
.then(function (output) {
  outputDir = output;
})
.then(run)
.catch(console.error)

function initOutputDir (basePath) {
  return new Promise( (resolve, reject) => {
    let outputDirPath = path.join(basePath, runDate.toISOString().substr(0,10));
    fs.access(outputDirPath, function (err){
      if (err) {
        console.log(`Création du répertoire ${outputDirPath}`);
        return fs.mkdir(outputDirPath, function (err) {
          if (err) {
            reject(new Error(`Impossible de créer le répertoire ${outputDirPath}`));
          } else {
            resolve(outputDirPath);
          }
        });
      } else {
        // TODO : Gérer la création d'un nouveau répertoire si celui-ci existe
        reject(new Error(`Le répertoire ${outputDirPath} existe déjà`));
      }
    });
  });
}

function getLastRunDate () {
  let lastRunBuffer = fs.readFileSync(lastRunFile);
  let lastRunString = lastRunBuffer.toString().split("\n")[0];
  let lastRun = new Date(lastRunString);
  console.log(`Date de dernière execution : ${lastRun.toISOString().substr(0,10)}`);
  return lastRun;
}

function writeRunDate () {
  if(!quietMode) {
    fs.writeFileSync(lastRunFile, runDateString)
  }
}

let quietMode = (process.argv[2] == 'quiet');
if(quietMode) {
  console.log('Execution à vide');
}

function run () {
  readSubscrFile(inputFile) // Lit le fichier des abonnements
  .then(parseSubscrFile)    // Parse l'XML lu
  .then(getChannels)        // Extrait la liste des chaines
  .then(function (channelList) {
    return Promise.all(channelList.map(getVidsForChannel)); // Pour chaque chaine, récupère la liste des vidéo
  })
  .then(function (allVids) {
    return Promise.all(allVids.map(readChannelFile));       // Pour chaque chaine, parse la liste des vidéos
  })
  .then(function (parsedVids) {
    return parsedVids.map(getVids);                         // Pour chaque chaine, extrait la liste des vidéos
  })
  .then(function (vids) {
    return vids.reduce(function (tab, channelVid) {         // Concatène les tableaux de vidéo des différentes chaines
      return tab.concat(channelVid);
    }, [])
  })
  .then(filterAndSort)      // Filtre et trie les vidéos
  .then(buildArgsList)
  .then(download)
  .then(writeRunDate)
  .catch((err) => console.dir(err));
}

// Lit le fichier des abonnements
function readSubscrFile (file) {
  return new Promise((resolve, reject) => {
    fs.readFile(inputFile, function (err, data) {
      if (err) {
        return reject(err);
      }
      return resolve(data);
    });
  });
}

// Parse le contenu du fichier des abonnements (inputFile)
function parseSubscrFile (data) {
  return new Promise ((resolve, reject) => {
    parser.parseString(data, (err, data) => {
      if (err) {
        return reject(err);
      }
      return resolve(data);
    })
  })
}

// Génère un tableau des chaines d'après la liste lue dans inputFile
function getChannels (jsonifiedSubscrXML) {
  return new Promise((resolve, reject) => {
    let channelList = [];
    jsonifiedSubscrXML.opml.body[0].outline[0].outline.map(function (channel) {
      channelList.push({
        title: channel.$.title,
        xmlUrl: channel.$.xmlUrl
      });
    });
    resolve(channelList);
  });
}

// Récupère le fichier listant les vidéos pour une chaine
function getVidsForChannel (channel) {
  return new Promise ((resolve, reject) => {
    fetch(channel.xmlUrl)
    .then( (res) => {
      resolve(res.text());
    })
    .catch( (err) => {reject(err)})
  })
}

// Parse le fichier d'une chaine
function readChannelFile (data) {
  return new Promise((resolve, reject) => {
    parser.parseString(data, function (err, parsedData) {
      if (err) {
        console.log(data);
        return reject(err);
      }
      return resolve(parsedData)
    });

  });
}

// Garde uniquement les infos interessantes de la liste de videos d'une chaine
function getVids (channelParsedXML) {
  let vids = [];
  if (channelParsedXML.feed.entry) {
    channelParsedXML.feed.entry.map(function (video) {
      // console.dir(video.author[0]);
      vids.push({
        title: sanitize(video.title[0]),
        url: video.link[0].$.href,
        pubDate: new Date(video.published),
        author: video.author[0].name[0]
      })
    });
  }
  return vids;
}

// Filtre les vidéos plus récente que  et les trie par ordres chronologique (de la plus ancienne à la plus récente)
function filterAndSort (videoArray) {
  let vidToDownload = videoArray
    .filter(function (video) {
      return video.pubDate > lastRun;
    })
    .sort(function (vidA, vidB) {
      return vidA.pubDate < vidB.pubDate ? -1 : 1;
    })
  if(quietMode) {
    console.log(vidToDownload);
    return [];
  } else {
    return vidToDownload;
  }
}

// Génère pour chaque objet video la liste des arguments à passer à youtube-dl
function buildArgsList (videoArray) {
  let args = [];
  let i = 0;
  videoArray
    .forEach(function (video) {
      i++;
      let stringIndex = to3String(i);
      args.push([
        '-o',
        path.join(outputDir, stringIndex + ' - ' + video.author + ' - ' + video.title +'.%(ext)s'),
        video.url
      ])
    });
    return args;
}

// Télécharge chaque vidéo selon les paramètres de args
function download (args) {
  for (vid of args) {
    console.log(`Download of ${vid[2]}`);
    spawnSync('youtube-dl', vid, {stdio: 'inherit'});
  }
}

function to3String (num) {
  let string = num.toString();
  while (string.length < 3) {
    string = "0"+string;
  }
  return string;
}
