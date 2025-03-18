// utility function to get the active tab
export async function getCurrentTab() {
    let queryOptions = { active: true, lastFocusedWindow: true };
    // `tab` will either be a `tabs.Tab` instance or `undefined`.
    let [tab] = await chrome.tabs.query(queryOptions);
    return tab;
  }

// utility function for IO 
export async function loadJSON(filename) {
    try {
      const response = await fetch(chrome.runtime.getURL(filename));
      const data = await response.json();
      console.log('Data loaded:', data);
      return data;
    } catch (error) {
      console.error('Error loading JSON:', error);
    }
  }

// calculating how many neighbours can be helped before hitting the resource cap to avoid wasting rewards
export function computeNeighbourHelpCap(currentGold, maxGold, neighbours) {
    const helpReward = 0.003 * maxGold
    const totalReward = neighbours * helpReward
    const neighbourCap = Math.floor( (maxGold - currentGold) / helpReward )
    let totalRewardFormat;
    if (totalReward <= 1e3) {
        totalRewardFormat = totalReward.toString()
    } else if (totalReward <= 1e6) {
        totalRewardFormat = (totalReward/1e3).toFixed(1) + "K"
    } else if (totalReward <= 1e9){
        totalRewardFormat = (totalReward/1e6).toFixed(1) + "M"
    } else {
        totalRewardFormat = (totalReward/1e9).toFixed(1) + "B"
    }
    return [totalRewardFormat, neighbourCap]
}
