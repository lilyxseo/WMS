import {syncNetsuite} from './_netsuite-service.js';
import {handleManualInventorySync} from './_manual-endpoint.js';
export function onRequestPost(context){return handleManualInventorySync(context,{source:'netsuite',sync:syncNetsuite});}
