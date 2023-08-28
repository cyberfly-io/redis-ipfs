import CryptoJS from 'crypto-js'
import Pact from 'pact-lang-api';
export const getSteamName = (senderKey: string, receiverKey: string)=>{
    const sortedKeys = [senderKey, receiverKey].sort(); // Sort the public keys
    const concatenatedKeys = sortedKeys.join(''); // Concatenate the sorted public keys
    const hash = CryptoJS.SHA256(concatenatedKeys); // Generate SHA-256 hash
    const uniqueIdentifier = hash.toString(CryptoJS.enc.Hex); // Get the hexadecimal representation of the hash
    return uniqueIdentifier;
  }

  export const check_authentication = (cmd:any) => {
    const pubKey = cmd.pubKey;
    const sig = cmd.sig;
    const deviceExec = cmd.device_exec;
  
    if (pubKey && sig && deviceExec) {
      const verify = Pact.crypto.verifySignature(deviceExec, sig, pubKey);
      if (verify) {
        return true
      } else {
        return false;
      }
    }
  };