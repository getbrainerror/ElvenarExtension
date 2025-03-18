import { loadJSON, getCurrentTab, computeNeighbourHelpCap } from "./utils.js";

// we asynchronously load some game data first and foremost: 
const NAME_DICTIONARY = loadJSON("nameDictionary.json") // translates variable names from server response into player-readable names


// Then we wait for the HTML content to be fully loaded before dynamically manipulating the UI
document.addEventListener("DOMContentLoaded", async () => {
    // we check if we are on an Elvenar page before proceeding
    const pageIsElvenar = await checkWebsite();

    if (pageIsElvenar){
        // if we are on the right page, display a loading screen at first before we update the data
        displayLoadingScreen("init")
        updatePageData()
    } else {
        wrongPageUI(); 
    }
});

// Add a listener to display error messages from the background:
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type == "ERROR_MESSAGE") {
        displayError(message.error)
    }
})

async function checkWebsite() {
    // checks if we are on elvenar
    const tab = await getCurrentTab();
    return ( tab && tab.url && tab.url.includes("elvenar.com/game") );
}

function displayError(error){
    const [errorMessage] = document.getElementsByClassName("error")
    // if there is already an error message, keep it as is so we get the deeper error from callstack
    if (errorMessage.innerText == "Unknown error") { 
        errorMessage.innerText = error
    }
    errorMessage.classList.add("active")
}

function displayLoadingScreen(loadingType){
    // mapping all the different loading screen names to the corresponding image files
    const loading2fileMap = {
        "init": "assets/initializeLoadingScreen.png",
        "watchAd": "assets/robotWatcher3.png", 
        "helpNeighbours": "assets/neighbourlyHelpLoadingScreen.png",
    };
    // getting loading screen with the right image and activating it:
    const loadingScreen = document.getElementById("loadingScreen")
    loadingScreen.getElementsByTagName("img")[0].setAttribute("src", loading2fileMap[loadingType])
    activateElement(loadingScreen); // active state triggers display via CSS
}

async function displayTreasureMessage(rewards, callback){
    const message = document.getElementById("treasure-message")
    const messageContentContainer = document.getElementById("treasure-container")
    const okButton = document.getElementById("treasure-button")
    const okIcon = document.getElementById("treasure-button-icon")
    const nameDictionary = await NAME_DICTIONARY
    let rewardItems = []
    // empty the content container first to get rid of previous messages if any:
    messageContentContainer
        .querySelectorAll(".reward-item")
        .forEach(rewardItem => messageContentContainer.removeChild(rewardItem))
    for (let reward of rewards){
        // if the rewrd is defined and has a subType, use it as key, otherwise set key as unknown
        const rewardKey = (reward && reward.subType) ? reward.subType.toLowerCase() : "unknown"
        // look for the name in dictionay. If not found, use the subType directly as name
        const rewardName = nameDictionary[rewardKey] ? nameDictionary[rewardKey] : reward.subType
        const rewardMessage = document.createElement("p")
        rewardMessage.classList.add("reward-item")
        rewardMessage.innerText = rewardName + " (x" + reward.amount + ")"
        rewardMessage.style.margin = 2
        rewardMessage.style.fontSize = 14
        rewardItems.push(rewardMessage)
        messageContentContainer.appendChild(rewardMessage)
    }
    // callback for ok button click
    const callbackWrapper = () => {
        // grey out the button to make it clear that the page is loading
        okIcon.style.filter = "grayscale(1)";
        okButton.style.cursor = "not-allowed";
        okButton.disabled = true
        requestAnimationFrame(callback) // update the UI before calling the page change
    }
    // display the button properly in case it was disabled before
    okIcon.style.filter = "grayscale(0)";
    okButton.style.cursor = "pointer"
    okButton.disabled = false
    okButton.addEventListener("click", callbackWrapper)
    activateElement(message)
}

function wrongPageUI(){
    // if we are not on Elvenar, adapt the UI to let the user know this is the wrong page
    const forbiddenPopupSize = [50, 450]
    const documentHtml = document.documentElement
    // stripping the popup of all html elements
    documentHtml.innerHTML=""
    // resizing the popup to better fit the display
    documentHtml.style.height = forbiddenPopupSize[0]
    documentHtml.style.width = forbiddenPopupSize[1]
    // creating the forbidden webpage header
    const forbiddenHeader = document.createElement("h3")
    forbiddenHeader.innerText = "Cette extension ne fonctionne que sur une page de jeu Elvenar"
    forbiddenHeader.style.alignSelf = "center"
    forbiddenHeader.style.justifySelf = "center"
    // adding the header to the body:
    document.body.appendChild(forbiddenHeader) 
    document.body.style.display = "flex"
    document.body.style.flexDirection = column
}

async function updatePageData(rewardData=[]) {
    // function sending a message to background so that it fetches ad data and stores it in local. UI will be updated as callback
    const sendMessage = () => chrome.runtime.sendMessage({ action: "getPlayerData" }, updatePageUI);

    if (rewardData && rewardData.length > 0){
        // if we are passing some data about rewards, we first need to let the user know about it and wait for his click
        console.log("J'ai trouvé " + rewardData.length + "trésors!")
        for (let reward of rewardData){
            console.log(reward["subType"] + "x" + reward["amount"])
        }
        displayTreasureMessage(rewardData, sendMessage)
    } else {
        // if no reward data, just send the message to background directly
        sendMessage()
    }
}

async function updatePageUI(response){
    const nameDictionary = await NAME_DICTIONARY;

    // ad section
    const adData = response.adData
    if (adData) {
        const adsContainer = document.getElementById("all-ads"); // HTML section container
        const adTemplate = document.getElementById("ad-template"); // an HTML template for an ad UI element
        for (let ad of adData) {
            if ( !(ad.featureId === "vitality_surge") ){
                const adItem = createAdItem(ad, adTemplate, nameDictionary) // populates the ad UI element
                adsContainer.appendChild(adItem) // adding it to the page
            }
        }
        if (adTemplate){
            adsContainer.removeChild(adTemplate); // when all is done, remove the template element
        }
    }
    
    // neighbour section
    const neighbours = response.neighbourData;
    const [currentGold, maxGold] = response.resourceData;
    const [totalReward, neighbourCap] = computeNeighbourHelpCap(currentGold, maxGold, neighbours);

    const neighbourButton = document.getElementsByClassName("neighbour-button")[0];
    const neighbourCountMessage = document.getElementById("neighbour-count");
    const neighbourWarning = document.getElementById("neighbour-warning");
    neighbourButton.addEventListener("click", onNeighbourClick) 
    neighbourCountMessage.innerText = neighbours + " voisins dans le besoin (" + totalReward + " pièces)"
    // setting the warnin message but displaying it only if we exceed the neighborCap
    neighbourWarning.innerText = "Je ne peux en aider que " + neighbourCap + " : vos caisses sont trop pleines!"
    const isWarningDisplayed = neighbourCap < neighbours // boolean controlling warning display
    activateElement(neighbourWarning, isWarningDisplayed)

    // deactivating the loading screen
    activateElement(document.getElementById("loadingScreen"), false)
    activateElement(document.getElementById("treasure-message"), false)
}

function createAdItem(ad, adTemplate, nameDictionary){
    // we first check if the ad element already exists. If not, we create it by copying the template
    let adElement = document.getElementById(ad.featureId);
    if (!adElement && adTemplate) {
        adElement = adTemplate.cloneNode(true);
        adElement.setAttribute("id", ad.featureId); // setting the id of the element to check its existence next time
    }
    // getting all the dynamic HTML elements into variables
    const adMessage = adElement.getElementsByClassName("ad-message")[0];
    const adTitle = adElement.getElementsByClassName("ad-title")[0];
    const selectBonusContainer = adElement.getElementsByClassName("select-bonus-container")[0];
    const selectBonus = adElement.getElementsByClassName("select-bonus")[0];
    const selectAmount = adElement.getElementsByClassName("select-amount")[0];
    const playButton = adElement.getElementsByClassName("play-button")[0];
    const playIcon = adElement.getElementsByClassName("play-icon")[0];

    // updating the ad data directly in the element for easy access by click listeners callbacks
    adElement.setAttribute("remaining", ad.remaining);
    adElement.setAttribute("adId", ad.adId);
    // updating UI elements with relevant data
    adTitle.innerText = nameDictionary[ad.featureId.toLowerCase()];
    adMessage.innerText = `${ad.remaining} restant(s)`;
    // populating the quantity selection according to remaining ads
    selectAmount.innerHTML = "";
    for (let i=ad.remaining; i>0; i--) {
        selectAmount.options.add(new Option(i, i));
    }
    // we check if the ad needs to specify its target
    if (ad.targets) {
        // if targets are required, we populate the select element accordingly
        selectBonus.innerHTML = "";
        let bonusName=""
        for (let target of ad.targets) {
            bonusName = nameDictionary[target.toLowerCase()] ? nameDictionary[target.toLowerCase()] : target // if name not recorded in dict, keep its cryptic server name 
            selectBonus.options.add(new Option(bonusName, target));
        }
    } else if (selectBonus) {
        // if targets are not required but the target selection element is present, replace it by a simple text
        replaceSelectBonusAuto(selectBonusContainer, selectBonus);
    }

    playButton.addEventListener("click", onWatchAd); 

    // handle the case where there are no ads available:
    if (ad.remaining === 0) {
        selectAmount.options.add(new Option("--- y'a pu ---", 0)); // select element was empty: adding a single "empty" option
        // disabling play button and styling it accordingly for clarity
        playButton.disabled = true;
        playButton.style.cursor = "not-allowed";
        playIcon.style.filter = "grayscale(1)"
    }
    return adElement
}

function replaceSelectBonusAuto(selectBonusContainer, selectBonus) {
    // for ads with no selection available, this function replaces the HTML select element by a simple text
    let automaticBonusMessage = document.createElement("p");
    // styling the text
    automaticBonusMessage.innerText = "--auto--";
    automaticBonusMessage.style.alignSelf = "center";
    automaticBonusMessage.style.height = "fit-content";
    automaticBonusMessage.style.margin = "0";
    automaticBonusMessage.style.padding = "0";
    automaticBonusMessage.style.color = "gray";
    automaticBonusMessage.style.fontStyle = "italic";
    automaticBonusMessage.style.fontSize = "11px";
    selectBonusContainer.removeChild(selectBonus); // removing the select box
    selectBonusContainer.appendChild(automaticBonusMessage); // replacing it with a text reading "automatic"
}

function onWatchAd(event){
    // callback function for a click on the 'play ad' button
    const actionName = "watchAd"
    displayLoadingScreen(actionName) 
    // getting user input from the select HTML elements (located in the parent container of the play button)
    const selectBonus = event.currentTarget.parentElement.getElementsByClassName("select-bonus")[0];
    const selectAmount = event.currentTarget.parentElement.getElementsByClassName("select-amount")[0];
    // sending a message to background with the appropriate data to let it trigger the ad watching logic
    const messageToBackground = { 
        action: actionName,
        featureId: event.currentTarget.parentElement.getAttribute("id"), 
        adId: event.currentTarget.parentElement.getAttribute("adId"),
        target: selectBonus ? selectBonus.value : undefined,
        amount: selectAmount ? selectAmount.value : undefined
    };
    chrome.runtime.sendMessage(messageToBackground, updatePageData);
}

function onNeighbourClick(event){
    // callback function for click on 'help neighbours' button
    const actionName = "helpNeighbours"
    displayLoadingScreen(actionName)
    chrome.runtime.sendMessage({action: actionName}, updatePageData); // relaying message to background
}

// helper function to activateElement
function activateElement(element, activate=true){
    const classList = element.classList
    const activeKeyword = "active"
    if (activate){
        if (!classList.contains(activeKeyword)) classList.add(activeKeyword)
    } else {
        if (classList.contains(activeKeyword)) classList.remove(activeKeyword)

    }
}

