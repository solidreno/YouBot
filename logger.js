const fs = require('fs');
const path = require('path');

function makeLogger (logFile, quietMode) {
  let log = function (message) {
    // Gestion des message 'object'
    let messageString = message;
    if (typeof message == 'object') {
      messageString = JSON.stringify(message, null, 2);
    }

    // Si mode non quiet, ecriture dans le fichier
    if (!quietMode) {
      fs.appendFileSync(logFile, `${messageString}\n`);
    }
    console.log(messageString);
  }
  return log;
}

module.exports = makeLogger;
