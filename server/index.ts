import express from 'express';
import { RipDBServerClient } from 'cyberfly-rip-db-server';
import { NFTStorage } from 'nft.storage';
import { Blob } from 'node:buffer';
import dotenv from 'dotenv';
import cors from 'cors';
import fetch from 'node-fetch';
import http from "http";
import { Server } from "socket.io";
import { check_authentication, getSteamName } from './utils.js';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const port = 3000;

const ripServer = new RipDBServerClient({
  redisUrl: process.env.REDIS_URL || '',
  ipfsApiKey: process.env.IPFS_KEY || '',
});

app.post('/set/:key', async (req, res) => {
  const start = Date.now();
  const wrappedData = await ripServer.set(req.params.key, req.body);

  res.send({ duration: Date.now() - start, ...wrappedData });
});

app.get('/get/:key', async (req, res) => {
  const start = Date.now();
  let wrappedData;
  try {
    wrappedData = await ripServer.get(req.params.key);
  } catch (e) {
    console.log('GOT THE ERROR MESSAGE: ', e.message);
    if (e.message === 'No value stored with this key') {
      res.status(404).send('Not Found');
      return;
    }
    throw e;
  }

  res.send({ duration: Date.now() - start, ...wrappedData });
});

// TODO - add auth to this endpoint.
// only an "owner" address should be able
// to purge the cache for now
app.post('/purge/:key', async (req, res) => {
  await ripServer.purge(req.params.key);
  await res.send({ status: 'failed purge not yet supported' });
});

/**
 * BELOW ARE SOME OPTIONAL BENCHMARKING ENDPOINTS
 * FEEL FREE TO REMOVE IF YOU ARE HOSTING YOUR OWN SERVER
 */

const rawIPFSClient = new NFTStorage({ token: process.env.IPFS_KEY || '' });

app.post('/ipfs/set', async (req, res) => {
  // slightly modify the data so the comparison is with two different CIDs
  const body = { ...req.body, slight: 'modification' };
  const dataStr = JSON.stringify(body);

  const blob = new Blob([dataStr], { type: 'application/json' });

  const startTime = Date.now();
  // @ts-ignore
  await rawIPFSClient.storeBlob(blob);
  const duration = Date.now() - startTime;

  res.send({ duration });
});

app.get('/ipfs/get/:key', async (req, res) => {
  try {
    // read CID from RIPDB
    const response = await ripServer.get(req.params.key);
    if (!response) {
      throw new Error('No value stored with this key');
    }
    const { cid } = response;
    const startTime = Date.now();

    await fetch(`https://ipfs.io/ipfs/${cid}`);
    const duration = Date.now() - startTime;
    res.send({ duration });
  } catch (e) {
    console.log('THE MESSAGE: ', e.message);
    if (e.message.indexOf('No value stored with this key') !== -1) {
      res.status(404).send('Not Found');
      return;
    }
    throw e;
  }
});

app.get('/chat/history', async (req, res) => {
  const afterMessageId = req.query.after || '-';
  const stream = req.query.stream
  const response = await ripServer.xrange(stream.toString(), afterMessageId);
  res.json(response);
});


const subscribedSockets: Record<string, Set<string>> = {}; // Keep track of subscribed channels for each socket

io.on("connection", (socket: any) => {
  socket.on("subscribe", async (channel: string) => {
    if (!subscribedSockets[socket.id]) {
      subscribedSockets[socket.id] = new Set();
    }
    subscribedSockets[socket.id].add(channel);

    ripServer.subscribe(channel, (channel: string, message: string) => {
      if (subscribedSockets[socket.id]?.has(channel)) { // Check if the socket is subscribed to the channel
        io.to(socket.id).emit("new message", { channel: channel, message: message });
      }
    });
  });

  socket.on("unsubscribe", async (channel: string) => {
    if (subscribedSockets[socket.id]) {
      subscribedSockets[socket.id].delete(channel);
      if (subscribedSockets[socket.id].size === 0) {
        delete subscribedSockets[socket.id];
      }
    }
    ripServer.unsubscribe(channel);
  });
  socket.on("send message", async(channel: string, stream:string ,message: string)=>{
    const msg = JSON.parse(message)
    const from_account = JSON.parse(msg['device_exec'])['fromAccount']
    const public_key = from_account.split(':')[1]
    if(stream===getSteamName(public_key, channel) && check_authentication(msg)){
      const message_id = await ripServer.xadd(stream, {"message":message})
      msg['message_id'] = message_id
      socket.emit("message id", message_id);
      ripServer.publish(channel, JSON.stringify(msg))
    }
  })
  socket.on("disconnect", () => {
    if (subscribedSockets[socket.id]) {
      subscribedSockets[socket.id].forEach((channel) => {
        ripServer.unsubscribe(channel);
      });
      delete subscribedSockets[socket.id];
    }
  });
});




server.listen(port, () => {
  console.log(`Example RipDB server listening on port ${port}`);
});
