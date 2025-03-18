// this is a script to be injected in the game page
// Its sole purpose is to extract javascript variables from the page (game data), and message them back to content script

(function() {
  console.log("script injection ok")
  window.postMessage({ gameVars: window.gameVars }, "*");
  })();