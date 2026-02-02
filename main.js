import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { io } from 'socket.io-client';

// ゲームの状態
const state = {
    socket: null,
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    players: {}, // id -> mesh
    hp: 5,
    isAlive: true,
    isPlaying: false,
    myId: null,
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    velocity: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    lastPos: new THREE.Vector3(),
    raycaster: new THREE.Raycaster(),
    shootCooldown: 0
};

// DOM要素
const lobby = document.getElementById('lobby');
const waiting = document.getElementById('waiting');
const hud = document.getElementById('hud');
const gameOver = document.getElementById('game-over');
const startBtn = document.getElementById('start-btn');
const replayBtn = document.getElementById('replay-btn');
const exitBtn = document.getElementById('exit-btn');
const matchTimer = document.getElementById('match-timer');
const waitingStatus = document.getElementById('waiting-status');
const aliveCount = document.getElementById('alive-count');
const hpFill = document.getElementById('hp-fill');
const resultText = document.getElementById('result-text');
const resultSubtext = document.getElementById('result-subtext');

// 初期化
function init() {
    setupScene();
    setupLighting();
    createIsland();
    animate();

    startBtn.addEventListener('click', joinGame);
    replayBtn.addEventListener('click', () => location.reload());
    exitBtn.addEventListener('click', () => location.reload());

    window.addEventListener('resize', onWindowResize);
}

function setupScene() {
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x87ceeb); // Sky Blue
    state.scene.fog = new THREE.FogExp2(0x87ceeb, 0.01);

    state.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    state.camera.position.y = 1.6;

    state.renderer = new THREE.WebGLRenderer({ antialias: true });
    state.renderer.setPixelRatio(window.devicePixelRatio);
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.renderer.shadowMap.enabled = true;
    document.getElementById('app').appendChild(state.renderer.domElement);

    state.controls = new PointerLockControls(state.camera, document.body);

    state.renderer.domElement.addEventListener('click', () => {
        if (state.isPlaying && state.isAlive) {
            state.controls.lock();
        }
    });

    document.addEventListener('keydown', (e) => onKeyDown(e));
    document.addEventListener('keyup', (e) => onKeyUp(e));
    document.addEventListener('mousedown', (e) => {
        if (state.controls.isLocked && state.isAlive) shoot();
    });
}

function setupLighting() {
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    hemiLight.position.set(0, 20, 0);
    state.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(3, 10, 10);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -50;
    dirLight.shadow.camera.left = -50;
    dirLight.shadow.camera.right = 50;
    state.scene.add(dirLight);
}

function createIsland() {
    // 地面 (砂浜)
    const groundGeo = new THREE.PlaneGeometry(200, 200, 32, 32);
    // 地面に少し凹凸をつける
    const posArr = groundGeo.attributes.position.array;
    for (let i = 0; i < posArr.length; i += 3) {
        posArr[i + 2] = Math.sin(posArr[i] / 5) * Math.cos(posArr[i + 1] / 5) * 0.5;
    }
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xedc9af }); // Sand color
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    state.scene.add(ground);

    // 海
    const waterGeo = new THREE.PlaneGeometry(1000, 1000);
    const waterMat = new THREE.MeshStandardMaterial({
        color: 0x0077be,
        transparent: true,
        opacity: 0.6
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.5;
    state.scene.add(water);

    // オブジェクト (岩や木をランダムに配置)
    for (let i = 0; i < 40; i++) {
        const isRock = Math.random() > 0.5;
        const mesh = isRock ? createRock() : createTree();
        mesh.position.set(
            (Math.random() - 0.5) * 80,
            0,
            (Math.random() - 0.5) * 80
        );
        state.scene.add(mesh);
    }
}

function createRock() {
    const geo = new THREE.DodecahedronGeometry(Math.random() * 2 + 1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const rock = new THREE.Mesh(geo, mat);
    rock.position.y = 0.5;
    rock.castShadow = true;
    rock.receiveShadow = true;
    return rock;
}

function createTree() {
    const group = new THREE.Group();
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 3);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.5;
    trunk.castShadow = true;
    group.add(trunk);

    const leavesGeo = new THREE.ConeGeometry(1.5, 4, 8);
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x228b22 });
    const leaves = new THREE.Mesh(leavesGeo, leavesMat);
    leaves.position.y = 4;
    leaves.castShadow = true;
    group.add(leaves);

    return group;
}

function joinGame() {
    lobby.classList.add('hidden');
    waiting.classList.remove('hidden');

    // 接続先を自分自身にする（Renderなどの本番環境対応）
    state.socket = io();

    state.socket.emit('join-game');

    state.socket.on('player-joined', (data) => {
        waitingStatus.innerText = `参加人数: ${data.playersCount} / 10`;
        matchTimer.innerText = data.timer;
    });

    state.socket.on('timer-update', (t) => {
        matchTimer.innerText = t;
    });

    state.socket.on('game-start', (data) => {
        startGame(data);
    });

    state.socket.on('player-moved', (data) => {
        updateRemotePlayer(data);
    });

    state.socket.on('npc-moved', (data) => {
        updateRemotePlayer(data, true);
    });

    state.socket.on('player-shot', (data) => {
        showTracer(data.origin, data.direction);
    });

    state.socket.on('npc-shot', (data) => {
        const dir = new THREE.Vector3(Math.sin(data.ry), 0, Math.cos(data.ry));
        showTracer(data.origin, dir);
    });

    state.socket.on('hp-update', (data) => {
        if (data.id === state.socket.id) {
            if (data.hp < state.hp) {
                const flash = document.getElementById('damage-flash');
                flash.classList.add('flash-active');
                setTimeout(() => flash.classList.remove('flash-active'), 100);
            }
            state.hp = data.hp;
            hpFill.style.width = (state.hp / 5 * 100) + '%';
        }
    });

    state.socket.on('player-died', (id) => {
        if (id === state.socket.id) {
            state.isAlive = false;
            state.controls.unlock();
            // 観戦モードへ (カメラを上げる等)
            new Promise(r => setTimeout(r, 1000)).then(() => {
                state.camera.position.y = 20;
                state.camera.lookAt(0, 0, 0);
            });
        }
        removePlayer(id);
    });

    state.socket.on('alive-update', (count) => {
        aliveCount.innerText = count;
    });

    state.socket.on('game-over', (data) => {
        endGame(data);
    });
}

function startGame(data) {
    waiting.classList.add('hidden');
    hud.classList.remove('hidden');
    state.isPlaying = true;
    state.controls.lock();

    // プレイヤーとNPCの生成
    for (const id in data.players) {
        if (id !== state.socket.id) {
            addPlayer(id, data.players[id]);
        } else {
            state.camera.position.set(data.players[id].x, 1.6, data.players[id].z);
        }
    }

    for (const id in data.npcs) {
        addPlayer(id, data.npcs[id], true);
    }
}

function addPlayer(id, data, isNPC = false) {
    const geo = new THREE.BoxGeometry(0.8, 1.8, 0.8);
    const mat = new THREE.MeshStandardMaterial({ color: isNPC ? 0xff0000 : 0x00ff00 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(data.x, 0.9, data.z);
    mesh.castShadow = true;
    state.scene.add(mesh);
    state.players[id] = mesh;
}

function updateRemotePlayer(data, isNPC = false) {
    const mesh = state.players[data.id];
    if (mesh) {
        mesh.position.set(data.x, 0.9, data.z);
        mesh.rotation.y = data.ry;
    }
}

function removePlayer(id) {
    const mesh = state.players[id];
    if (mesh) {
        state.scene.remove(mesh);
        delete state.players[id];
    }
}

function shoot() {
    if (state.shootCooldown > 0) return;
    state.shootCooldown = 10;

    const origin = state.camera.position.clone();
    const direction = new THREE.Vector3();
    state.camera.getWorldDirection(direction);

    state.socket.emit('shoot', { origin, direction });
    showTracer(origin, direction);

    // ヒット判定
    state.raycaster.set(origin, direction);
    const meshes = Object.values(state.players);
    const intersects = state.raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
        const hitMesh = intersects[0].object;
        const hitId = Object.keys(state.players).find(key => state.players[key] === hitMesh);
        if (hitId) {
            state.socket.emit('hit', hitId);
        }
    }
}

function showTracer(origin, direction) {
    const points = [];
    points.push(new THREE.Vector3(origin.x, origin.y - 0.2, origin.z));
    points.push(new THREE.Vector3(
        origin.x + direction.x * 50,
        origin.y + direction.y * 50,
        origin.z + direction.z * 50
    ));

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xffff00 });
    const line = new THREE.Line(geo, mat);
    state.scene.add(line);

    setTimeout(() => state.scene.remove(line), 100);
}

function endGame(data) {
    state.isPlaying = false;
    state.controls.unlock();
    gameOver.classList.remove('hidden');

    const isWinner = data.winnerId === state.socket.id;
    resultText.innerText = isWinner ? "YOU WIN!" : "GAME OVER";
    resultSubtext.innerText = isWinner ? "最後の1人として生き残りました！" : "残念ながら敗北しました。";
}

function onKeyDown(e) {
    switch (e.code) {
        case 'ArrowUp':
        case 'KeyW': state.moveForward = true; break;
        case 'ArrowLeft':
        case 'KeyA': state.moveLeft = true; break;
        case 'ArrowDown':
        case 'KeyS': state.moveBackward = true; break;
        case 'ArrowRight':
        case 'KeyD': state.moveRight = true; break;
    }
}

function onKeyUp(e) {
    switch (e.code) {
        case 'ArrowUp':
        case 'KeyW': state.moveForward = false; break;
        case 'ArrowLeft':
        case 'KeyA': state.moveLeft = false; break;
        case 'ArrowDown':
        case 'KeyS': state.moveBackward = false; break;
        case 'ArrowRight':
        case 'KeyD': state.moveRight = false; break;
    }
}

function onWindowResize() {
    state.camera.aspect = window.innerWidth / window.innerHeight;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    if (state.controls.isLocked && state.isAlive) {
        const time = performance.now();
        const delta = 0.1; // 固定デルタで簡易化

        state.velocity.x -= state.velocity.x * 10.0 * delta;
        state.velocity.z -= state.velocity.z * 10.0 * delta;

        state.direction.z = Number(state.moveForward) - Number(state.moveBackward);
        state.direction.x = Number(state.moveRight) - Number(state.moveLeft);
        state.direction.normalize();

        if (state.moveForward || state.moveBackward) state.velocity.z -= state.direction.z * 100.0 * delta;
        if (state.moveLeft || state.moveRight) state.velocity.x -= state.direction.x * 100.0 * delta;

        state.controls.moveRight(-state.velocity.x * delta);
        state.controls.moveForward(-state.velocity.z * delta);

        // 位置更新をサーバーに送信
        if (state.socket && (
            Math.abs(state.camera.position.x - state.lastPos.x) > 0.1 ||
            Math.abs(state.camera.position.z - state.lastPos.z) > 0.1
        )) {
            state.socket.emit('update-position', {
                x: state.camera.position.x,
                y: state.camera.position.y,
                z: state.camera.position.z,
                ry: state.camera.rotation.y
            });
            state.lastPos.copy(state.camera.position);
        }
    }

    if (state.shootCooldown > 0) state.shootCooldown--;

    state.renderer.render(state.scene, state.camera);
}

init();
