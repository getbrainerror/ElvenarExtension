import { sendRequest, sendErrorToPopup, getStoredDataPromise, throwErrorOnException } from "./httpRequests.js";
import { computeNeighbourHelpCap } from "./utils.js"

// setup listeners for messages from popup.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "watchAd") {
      // message from popup.js triggered when user clicks on the "watch ad" button
      const resp = watchAd(message.featureId, message.adId, message.target, message.amount);
      resp.then((response) => {
        if (message.featureId === "city_incident"){
          // in the case where we open a random treasure (city_incident), we need to communicate what we got from it
          const rewards = response.find((resp)=>resp["requestMethod"] === "getRewards")["responseData"]["rewards"]
          sendResponse(rewards)
        } else{
          sendResponse(null) // in other cases, no need to send back any data
        }
      })
      .catch(error => sendErrorToPopup(error, "Error while post-processing ads response"));
      return true;
    } 
    
    else if (message.action === "getPlayerData") {
      // message from popup.js when data is required to populate the UI with the amount of ads available, etc...
      fetchStartupData()
        .then(async (playerData) => {
          let friendsInNeed = await fetchNeighbours();
          playerData["neighbourData"] = friendsInNeed.length;
          sendResponse(playerData);
        })
      return true;
    } 
    
    else if (message.action === "helpNeighbours"){
      // message from popup.js triggered when the user clicks on the "help neighbours" button
      helpNeighbours()
        .then((r) => sendResponse(r))
      return true 
    }

});

async function watchAd(featureId, adId, target, amount) {
  let resp;
  const body = writeAdPayload(featureId, adId, target); // getting the POST payload

  // sending the same request multiple times (adId does not get updated by the server when calling the finish method)
  for (let i=0; i<amount; i++){
    // we will only keep the last response for logging purposes
    const errorMessage = "Error while watching ad"
    resp = sendRequest("finish", "VideoAdService", body)
  }
  return resp 
}

function writeAdPayload(adType, adId, target){
  // this function writes the POST payload to tell the game API that an ad has been watched. Follows API syntax.

  // names for the classes of requests for each type of ad:
  const classNames = {
    "builders_bonus": "VideoAdBuildersBonusFinishContextVO", 
    "city_incident": "VideoAdFinishContextVO",
    "research_kp": "VideoAdResearchKpFinishContextVO"
  };
  // filling up the request data based on the type of ad and its ID
  let requestData = {"provider":"Google AdSense", "adId":adId, "__clazz__":classNames[adType]};

  // builder/resarch bonuses need a special field to specify which target resource/technology will be boosted
  if (adType === "builders_bonus"){
    requestData["resourceId"] = target;
  } else if (adType === "research_kp") {
    requestData["techId"] = target
  }
  // the final payload starts by stating the adType in double quotes, separated by a comma from the requestData above
  return `"${adType}",` + JSON.stringify(requestData)
}

async function fetchStaticResearchData() {
  // this function fetches some static game data from an online json file
  let techDictionary = {}; 
  const [race, frontendUrl] = await Promise.all([getStoredDataPromise("race"), getStoredDataPromise("frontendUrl")])
  const staticName = race == "humans" ? "xml.balancing.research.ResearchTechnologiesHumans" : "xml.balancing.research.ResearchTechnologiesElves"
  const staticUrl = await getStoredDataPromise("manifestUrl")
    .then(url => fetch(url))
    .then(r=>r.json())
    .then(data => frontendUrl + "/" + staticName + "_" + data["static_files"][staticName] + ".json")
  const staticData = await fetch(staticUrl)
    .then((response) => response.json())
    .then(serverData => throwErrorOnException(serverData))
    .catch(error => sendErrorToPopup(error, "Error fetching static data"));
  for (let tech of staticData) {
    techDictionary[tech["id"]] = [tech["parentIds"], tech["maxSP"]]; // reorganizing the data to get info from a techId
  }
  return techDictionary;
}

async function fetchUserResearchData() {
  // this function fetches some server-updated game data 
  let userResearchData = await sendRequest("startup", "ResearchService", "")
  let userTechDictionary = {}
  // selecting research data:
  const techData = userResearchData.find((resp)=>resp["requestClass"] === "ResearchService")["responseData"]; 
  // for each technology, extracting the relevant information and reorganizing the structure:
  for (let tech of techData){
      let techProgress = tech["progress"];
      let techId = tech["id"];
      userTechDictionary[techId] = [techProgress["is_paid"], techProgress["currentSP"]]; // reorganizing data
    }
  return userTechDictionary;
}

function parseResearchData(userData, staticData){
  // ok this one is an uncommented mess and god only knows how it works at this point. I'll come back to it (maybe)
  let currentResearch = [];
  for (let [techId, [parents, maxSP]] of Object.entries(staticData)){
    if ( (!userData[techId] || !userData[techId]?.[0]) && 
    (!parents || ( parents.every((p) => userData[p]) && parents.every((p)=>userData[p][0]) ) ) ) {
      if (techId !== "humans_root"){
        currentResearch.push(techId);
      }
    }
  }
  return currentResearch;
}

async function fetchStartupData(){
  // fetching data related to research
  const techDictionary = fetchStaticResearchData();
  const userTechDictionary = fetchUserResearchData();
  const currentResearch = parseResearchData(await userTechDictionary, await techDictionary);

  // fetching data related to ads
  const serverResponse =  sendRequest("getData", "StartupService", "[]")
  const startupData = await parseAndStoreStartupData(serverResponse, currentResearch);
  return startupData;
}

async function parseAndStoreStartupData(dataPromise, currentResearch){
  const data = await dataPromise
  let adData = [];
  let builderResources = [];
  let currentBoost;
  let currentGold;
  let maxGold

  for (let service of data){
    
    // we build the list of available builder bonuses, only if there is no boost currently going on (!currentBoost)
    if (service["requestMethod"] === "getBuildersBonusConfig" && !currentBoost){ 
        for (let bonusType of service["responseData"]){
          builderResources.push(bonusType["resourceId"]);
        }
    }

    // we check if there is an ongoing builder bonus
    if (service["requestClass"] === "EffectsService" && service["requestMethod"] === "update"){
      for (let effect of service["responseData"]){
        if (effect["type"] === "builders_bonus"){
          currentBoost = effect["owner"]
          // if builderResources have already been filled, empty them first so that only the current boost is available
          while (builderResources.length > 0){
            builderResources.pop()
          }
          builderResources.push(currentBoost)
        }
      }
    }

    if (service["requestMethod"] === "getFeatures"){
        for (let adType of service["responseData"]){
          const remainingAds = adType["remaining"] ? adType["remaining"] : 0;
          const adId = adType["adId"];
          const featureId = adType["featureId"];
          let adTypeData = {
            "featureId": featureId,
            "remaining": remainingAds,
            "adId": adId
          }

          if (featureId === "builders_bonus"){
            adTypeData["targets"] = builderResources;
          } else if (featureId === "research_kp") {
            adTypeData["targets"] = currentResearch;
          }
          adData.push(adTypeData);
        }
    }


    if (service["requestClass"] === "StartupService" && service["requestMethod"] === "getData") {
      currentGold = service["responseData"]["resources"]["resources"]["money"]
      maxGold = service["responseData"]["resources_cap"]["resources"]["money"]
    }
  }
  // chrome.storage.local.set({ "adData": storedData });
  return {"adData": adData, "resourceData": [currentGold, maxGold]};
}


async function fetchNeighbours(){
  const neighboursData = await sendRequest("getDiscoveredPlayerProvinces", "WorldMapService", "")
  const friendsInNeed = [];
  for (let player of neighboursData[0]["responseData"]){
    if (!player["cool_down"]){
      friendsInNeed.push(player["player_id"]);
    }
  }
  return friendsInNeed; 
}

function treasureHasSpawned(serverResponses){
  for (let resp of serverResponses){
    if (resp["requestMethod"] == "spawnTreasure"){
      return true;
    }
  }
  return false;
}

async function handleTreasure(serverData, simulatedData=false){
  if (simulatedData || treasureHasSpawned(serverData)){
    let treasureResponse;
    if (!simulatedData){
      treasureResponse = 
        await sendRequest("openTreasure", "TreasureService", '"neighbourly_help"')
    }
    else {
      treasureResponse = simulateTreasureData()
    }
    const rewards = treasureResponse.find((resp) => resp["requestMethod"] === "openTreasure")["responseData"]
    const [nameKey, amountKey] = ["subType", "amount"]
    for (let reward of rewards){
      if ( !reward[nameKey] && (reward["type"] === "knowledge_points") ){
        reward[nameKey] = reward["type"]
      } else if (!reward[nameKey]) {
        reward[nameKey] = "unknown"
      }
      console.log("J'ai trouvé des trésors ! (" + reward[nameKey] + "x" + reward[amountKey] + ")");
    }
    return rewards;
  } else {
    return []
  }
}

function simulateTreasureData(){
  // simulates some treasure response for debugging purposes
  const rewards = [
    {"type": "knowledge_points", "amount": 1},
    {"subType": "relic_crystal", "amount": 1},
    {"subType": "spell_good_production_boost_1", "amount": 1}
  ]
  const openTreasureMethod = {
    "requestMethod": "openTreasure",
    "responseData": rewards
  }
  const dummyMethod ={
    "requestMethod": "dummy",
    "responseData": []
  }
  return [dummyMethod, openTreasureMethod]
}

async function helpNeighbours(){
  const startTime = performance.now(); // starting the timer for performance check
  const friendsInNeed = await fetchNeighbours(); // get the neighbour list
  const startupData = await fetchStartupData(); // get startupData to calculate resource caps
  const [currentGold, maxGold] = startupData.resourceData;
  let [_, neighbourCap] = computeNeighbourHelpCap(currentGold, maxGold, friendsInNeed.length);
  let data;
  let serverResponses = [];
  let allRewards = [];
  let counter = 0;

  for (let friend of friendsInNeed){
    counter ++;
    if ( counter > neighbourCap ){
      console.log("resource cap reached, stopping neighbour help.");
      break;
    }
    data = `"unlimited_help",1,${friend}`;
    // preparing array of promises to launch asynchronously
    serverResponses.push(
      sendRequest("performHelp", "NeighbourlyHelpService", data)  // helps a neighbour 
      .then(serverData => handleTreasure(serverData))  // checks if treasure has spawned from neighbourly help and gathers it
      .then(rewards => allRewards.push(...rewards))  // storing all treasure rewards in one array for final display
    );
  }
  await Promise.all(serverResponses);  // waiting until all the ansynchronous calls resolve 
  console.log("all rewards: ");
  console.log(allRewards);
  // printing performance time:
  const endTime = performance.now(); 
  console.log("Neighbour help done in ", (endTime - startTime) / 1000, "s.");
  return allRewards;
}


