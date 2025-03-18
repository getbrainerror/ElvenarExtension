(() => {   
    sendGameVarsToBackground();
})();

function sendGameVarsToBackground(){
    // This function's purpose is to extract some JS variables from the game page and send it back to background.
    // To do so, since contentScript runs in a context isolated from the page itself, it needs to inject a script into it
    // The injected script then runs in the page context -> accesses game variables -> sends message back to content

    // create script and links it to our injectedScript.js file
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injectedScript.js");

    (document.head || document.documentElement).appendChild(script);

    //listen to messages from injected script:
    window.addEventListener("message", (event) => {
        if (event.source !== window || !event.data.gameVars) return; // checking that this is the right message
        // Forward the data to the background script
        console.log("Elvenar Helper extension storing page data")
        const endpointUrl = "https:" + atob(event.data.gameVars.json_gateway_url);
        const endpoint = endpointUrl.split("h=")[1] // extracting the tag from the url (used for message encryption)
        const manifestName = atob(event.data.gameVars.manifest);
        const frontendUrl = event.data.gameVars.basepath + "/frontend//static/" + event.data.gameVars.locale
        const manifestUrl = frontendUrl + "/" + manifestName + ".json"
        const race = event.data.gameVars.race
        const data = [endpointUrl, endpoint]
        chrome.storage.local.set({
            endpointData : data, 
            manifestUrl: manifestUrl, 
            race: race, 
            frontendUrl: frontendUrl
        });
      });
}