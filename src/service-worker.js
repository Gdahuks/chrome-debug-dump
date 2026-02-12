chrome.commands.onCommand.addListener(function(command) {
  if (command === 'dump') {
    chrome.runtime.sendMessage({ action: 'triggerDump' }).catch(function() {});
    chrome.storage.local.set({ triggerDump: Date.now() });
  }
});

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === 'dumpAll') {
    handleDump(message)
      .then(function(result) { sendResponse(result); })
      .catch(function(err) { sendResponse({ error: err.message }); });
    return true;
  }
});

function handleDump(message) {
  var folderName = message.folderName;
  var files = message.files;
  var screenshotDataUrl = message.screenshotDataUrl;

  var downloadPromises = [];

  var filenames = Object.keys(files);
  for (var i = 0; i < filenames.length; i++) {
    var filename = filenames[i];
    var content = files[filename];
    var dataUrl = textToDataUrl(content);
    downloadPromises.push(downloadFile(dataUrl, folderName + '/' + filename));
  }

  if (screenshotDataUrl) {
    downloadPromises.push(downloadFile(screenshotDataUrl, folderName + '/screenshot.jpg'));
  }

  return Promise.allSettled(downloadPromises).then(function(results) {
    var failures = results.filter(function(r) { return r.status === 'rejected'; });
    var succeeded = results.filter(function(r) { return r.status === 'fulfilled'; });

    // Extract absolute folder path from the first successful download
    var absolutePath = '';
    if (succeeded.length > 0 && succeeded[0].value) {
      var filePath = succeeded[0].value;
      var lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
      if (lastSlash > 0) {
        absolutePath = filePath.substring(0, lastSlash);
      }
    }

    return {
      success: true,
      downloadPath: absolutePath || folderName,
      filesDownloaded: succeeded.length,
      filesFailed: failures.length,
      screenshotCaptured: !!screenshotDataUrl
    };
  });
}


function textToDataUrl(text) {
  return 'data:application/octet-stream;base64,' + btoa(unescape(encodeURIComponent(text)));
}

function downloadFile(dataUrl, filename) {
  return new Promise(function(resolve, reject) {
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      conflictAction: 'uniquify',
      saveAs: false
    }, function(downloadId) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      function onChanged(delta) {
        if (delta.id !== downloadId) return;
        if (!delta.state) return;

        if (delta.state.current === 'complete') {
          chrome.downloads.onChanged.removeListener(onChanged);
          chrome.downloads.search({ id: downloadId }, function(items) {
            if (items && items[0]) {
              resolve(items[0].filename);
            } else {
              resolve('');
            }
          });
        } else if (delta.state.current === 'interrupted') {
          chrome.downloads.onChanged.removeListener(onChanged);
          reject(new Error('Download interrupted: ' + filename));
        }
      }
      chrome.downloads.onChanged.addListener(onChanged);
    });
  });
}
