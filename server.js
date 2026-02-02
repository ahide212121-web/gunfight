const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// ビルド済みの静的ファイル(dist)を配信
app.use(express.static(path.join(__dirname, 'dist')));

// ルートへのアクセスでindex.htmlを返す
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ゲーム状態の管理
let rooms = {};

function createRoom(id) {
  return {
    id: id,
    players: {},
    npcs: {},
    timer: 60,
    status: 'waiting', // waiting, playing, finished
    startTime: null,
    timerInterval: null
  };
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-game', () => {
    let roomId = Object.keys(rooms).find(id => rooms[id].status === 'waiting' && Object.keys(rooms[id].players).length < 10);

    if (!roomId) {
      roomId = 'room-' + Date.now();
      rooms[roomId] = createRoom(roomId);
    }

    const room = rooms[roomId];
    room.players[socket.id] = {
      id: socket.id,
      x: Math.random() * 40 - 20,
      z: Math.random() * 40 - 20,
      y: 0,
      ry: 0,
      hp: 5,
      isAlive: true,
      lastAction: Date.now()
    };

    socket.join(roomId);

    // 最初のプレイヤーが参加したらタイマー開始
    if (Object.keys(room.players).length === 1 && !room.timerInterval) {
      room.timerInterval = setInterval(() => {
        room.timer--;
        io.to(roomId).emit('timer-update', room.timer);

        if (room.timer <= 0 || Object.keys(room.players).length === 10) {
          startGame(roomId);
        }
      }, 1000);
    }

    io.to(roomId).emit('player-joined', {
      playersCount: Object.keys(room.players).length,
      roomId: roomId,
      timer: room.timer
    });
  });

  socket.on('update-position', (data) => {
    const roomId = Array.from(socket.rooms).find(r => r.startsWith('room-'));
    if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
      const p = rooms[roomId].players[socket.id];
      p.x = data.x;
      p.y = data.y;
      p.z = data.z;
      p.ry = data.ry;

      socket.to(roomId).emit('player-moved', {
        id: socket.id,
        x: p.x,
        y: p.y,
        z: p.z,
        ry: p.ry
      });
    }
  });

  socket.on('shoot', (data) => {
    const roomId = Array.from(socket.rooms).find(r => r.startsWith('room-'));
    if (roomId && rooms[roomId]) {
      socket.to(roomId).emit('player-shot', {
        id: socket.id,
        origin: data.origin,
        direction: data.direction
      });
    }
  });

  socket.on('hit', (targetId) => {
    const roomId = Array.from(socket.rooms).find(r => r.startsWith('room-'));
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    let target = room.players[targetId] || room.npcs[targetId];

    if (target && target.isAlive) {
      target.hp--;
      io.to(roomId).emit('hp-update', { id: targetId, hp: target.hp });

      if (target.hp <= 0) {
        target.isAlive = false;
        io.to(roomId).emit('player-died', targetId);
        checkGameStatus(roomId);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        io.to(roomId).emit('player-left', socket.id);

        if (Object.keys(rooms[roomId].players).length === 0) {
          clearInterval(rooms[roomId].timerInterval);
          delete rooms[roomId];
        } else {
          checkGameStatus(roomId);
        }
      }
    }
  });
});

function startGame(roomId) {
  const room = rooms[roomId];
  if (room.status !== 'waiting') return;

  clearInterval(room.timerInterval);
  room.status = 'playing';

  // NPCを補充
  const playerCount = Object.keys(room.players).length;
  const npcNeeded = 10 - playerCount;

  for (let i = 0; i < npcNeeded; i++) {
    const npcId = 'npc-' + i + '-' + Date.now();
    room.npcs[npcId] = {
      id: npcId,
      x: Math.random() * 80 - 40,
      z: Math.random() * 80 - 40,
      y: 0,
      ry: Math.random() * Math.PI * 2,
      hp: 5,
      isAlive: true,
      isNPC: true
    };
  }

  io.to(roomId).emit('game-start', {
    players: room.players,
    npcs: room.npcs
  });

  // NPCの動きのシミュレーションを開始
  startNPCLoop(roomId);
}

function startNPCLoop(roomId) {
  const interval = setInterval(() => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') {
      clearInterval(interval);
      return;
    }

    for (const id in room.npcs) {
      const npc = room.npcs[id];
      if (!npc.isAlive) continue;

      // 簡単なAI: ランダムに動き、たまに撃つ
      npc.x += Math.sin(npc.ry) * 0.1;
      npc.z += Math.cos(npc.ry) * 0.1;

      if (Math.random() < 0.05) npc.ry += (Math.random() - 0.5) * 0.5;

      // 境界チェック (無人島)
      if (Math.abs(npc.x) > 45 || Math.abs(npc.z) > 45) {
        npc.ry += Math.PI;
      }

      io.to(roomId).emit('npc-moved', {
        id: npc.id,
        x: npc.x,
        z: npc.z,
        ry: npc.ry
      });

      // たまに撃つ
      if (Math.random() < 0.01) {
        io.to(roomId).emit('npc-shot', {
          id: npc.id,
          origin: { x: npc.x, y: 1, z: npc.z },
          ry: npc.ry
        });
      }
    }
  }, 100);
}

function checkGameStatus(roomId) {
  const room = rooms[roomId];
  if (!room || room.status !== 'playing') return;

  const alivePlayers = Object.values(room.players).filter(p => p.isAlive).length;
  const aliveNPCs = Object.values(room.npcs).filter(n => n.isAlive).length;
  const totalAlive = alivePlayers + aliveNPCs;

  io.to(roomId).emit('alive-update', totalAlive);

  if (totalAlive <= 1) {
    room.status = 'finished';
    const winner = Object.values(room.players).find(p => p.isAlive) || Object.values(room.npcs).find(n => n.isAlive);
    io.to(roomId).emit('game-over', { winnerId: winner?.id });
  }
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
