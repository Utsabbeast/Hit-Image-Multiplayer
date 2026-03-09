const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- AUDIO ---
let isMuted = false;
const bellSound = new Audio('https://assets.mixkit.co/active_storage/sfx/947/947-preview.mp3');
const bgMusic = new Audio('https://cdn.pixabay.com/audio/2022/02/10/audio_fc48af67b1.mp3'); // Fun upbeat background
const selectSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2573/2573-preview.mp3');
const clickSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');
const stretchSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2704/2704-preview.mp3');
const thudSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2569/2569-preview.mp3'); // Clear, small tap sound

bgMusic.loop = true;
bgMusic.volume = 0.25;
selectSound.volume = 0.4;
clickSound.volume = 0.5;
stretchSound.volume = 0.3;
thudSound.volume = 1.0;

function toggleMute() {
    playClickSound();
    isMuted = !isMuted;
    bellSound.muted = bgMusic.muted = selectSound.muted = clickSound.muted = stretchSound.muted = thudSound.muted = isMuted;
    document.getElementById('mute-btn').innerText = isMuted ? "🔈" : "🔊";
}

function playSelectSound() { if (!isMuted) selectSound.play().catch(() => { }); }
function playClickSound() { if (!isMuted) clickSound.play().catch(() => { }); }

function showGameOver(title, score) {
    document.getElementById('game-over-title').innerText = title;
    document.getElementById('final-score').innerText = score;
    document.getElementById('game-over-overlay').style.display = 'flex';
    document.getElementById('hud').style.display = 'none';

    // Submit score to the global leaderboard
    submitScore(selectedTime, score);
}

// --- MULTIPLAYER ---
let ws = null;
let roomCode = "";
let playerId = Math.random().toString(36).substring(2, 9);
let opponentScore = 0;
let isSinglePlayer = false;

// --- ASSETS ---
let imagesReady = false;
const sharpenerImg = new Image();
sharpenerImg.src = 'https://img.icons8.com/3d-fluency/250/pencil-sharpener.png';

const targetUrls = [
    'https://img.icons8.com/3d-fluency/250/apple.png',
    'https://img.icons8.com/3d-fluency/250/open-box.png',
    'https://img.icons8.com/3d-fluency/250/orange-juice.png',
    'https://img.icons8.com/3d-fluency/250/book.png',
    'https://img.icons8.com/3d-fluency/250/calculator.png',
    'https://img.icons8.com/3d-fluency/250/microscope.png',
    'https://img.icons8.com/3d-fluency/250/globe.png',
    'https://img.icons8.com/3d-fluency/250/alarm-clock.png',
    'https://img.icons8.com/3d-fluency/250/pencil.png'
];
const targetImages = targetUrls.map(url => {
    const img = new Image();
    img.src = url;
    return img;
});

// Force start after 2 seconds even if images aren't ready
setTimeout(() => { imagesReady = true; }, 2000);

// --- GAME LOGIC ---
let timeLeft = 60, selectedTime = 60, level = 1, isPlaying = false, isDragging = false;
let currentTargetImg = null;
const sharpener = { x: 0, y: 0, w: 50, h: 50, vx: 0, vy: 0, active: false, rotation: 0 };
const target = { x: 0, y: 0, size: 85 };
let mouse = { x: 0, y: 0 };

let particles = [];
let floatingTexts = [];
let hasMovedSharpener = false;

// --- WIND EFFECTS ---
let windParticles = [];
let windActive = false;
let windTimer = 0;
let windSpeed = 0;

function startWind() {
    windActive = true;
    windTimer = 180 + Math.random() * 120; // 3-5 seconds
    windSpeed = (Math.random() > 0.5 ? 1 : -1) * (4 + Math.random() * 5); // 4 to 9 px/frame
}

function explode(x, y) {
    for (let i = 0; i < 20; i++) {
        particles.push({
            x: x + target.size / 2, y: y + target.size / 2,
            vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12,
            size: Math.random() * 6 + 4, life: 1,
            color: ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71', '#bdc3c7'][Math.floor(Math.random() * 5)]
        });
    }
    floatingTexts.push({ x: x + target.size / 2, y: y, text: "+1", life: 1, vy: -2 });
}

function init() {
    canvas.width = 400; canvas.height = 650;

    // Pick a random sticky note color for the menus
    const stickyColors = ['#fdfbf7', '#fcf4a3', '#ffc1cc', '#cbf0d1', '#d4c4fb', '#ffd5b5', '#b5ead7'];
    const randomPaperColor = stickyColors[Math.floor(Math.random() * stickyColors.length)];
    document.documentElement.style.setProperty('--paper-bg', randomPaperColor);

    resetSharpener();
    fetchLeaderboard(selectedTime);
}

function setTime(s) {
    playClickSound();
    timeLeft = s;
    selectedTime = s;
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
}

function joinRoom(argumentCode = null, startingTime = null, isCreator = false) {
    playClickSound();
    let input = argumentCode || document.getElementById('room-code-input').value.trim();
    if (!input) {
        showErrorBox("Please enter a room code!");
        return;
    }

    roomCode = input;
    document.getElementById('room-display').innerText = roomCode;
    
    // If we're creating a room, use the time we selected. If we're joining, the server will tell us the time later.
    if (startingTime) selectedTime = startingTime;

    // Initialize Audio context and full screen on user interact
    bgMusic.play().catch(() => { });
    requestFullScreen();

    // Show copy button and hide menu
    document.getElementById('hud').style.display = 'flex';
    document.getElementById('copy-container').style.display = 'block';
    document.getElementById('menu-overlay').style.display = 'none';

    document.getElementById('start-btn').innerText = "CONNECTING...";
    document.getElementById('start-btn').disabled = true;
    document.getElementById('create-btn').disabled = true;
    document.getElementById('single-player-btn').disabled = true;

    // Fetch player name
    let menuName = document.getElementById('player-name-input').value.trim();
    if (menuName) playerNameCache = menuName;
    if (!playerNameCache) playerNameCache = "Anonymous";

    // Connect to WebSocket
    let protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let encodedName = encodeURIComponent(playerNameCache);
    let wsUrl = `${protocol}//${window.location.host}/ws/${roomCode}/${playerId}/${encodedName}/${selectedTime}/${isCreator}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        document.getElementById('loading-status').innerText = "Waiting for Opponent...";
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "error") {
            showErrorBox(data.message);
            resetJoinUI();
        } else if (data.type === "room_state") {
            updateOpponentStatus(data);
        } else if (data.type === "game_start") {
            if (data.time_mode) {
                selectedTime = data.time_mode;
                timeLeft = selectedTime;
            }
            startGame();
        } else if (data.type === "player_left") {
            document.getElementById('opponent-status').innerText = "Disconnected!";
            document.getElementById('opponent-status').style.color = "#e74c3c";
            if (isPlaying) {
                isPlaying = false;
                let myScore = level - 1;
                let title = myScore > opponentScore ? "YOU WIN!" : (myScore < opponentScore ? "YOU LOSE!" : "DRAW!");
                showGameOver(title, myScore);
            }
        }
    };

    ws.onclose = () => {
        if (isPlaying) showErrorBox("Connection lost!");
        resetJoinUI();
    };
}

function resetJoinUI() {
    document.getElementById('menu-overlay').style.display = 'flex';
    document.getElementById('start-btn').innerText = "JOIN ROOM";
    document.getElementById('start-btn').disabled = false;
    document.getElementById('create-btn').disabled = false;
    document.getElementById('single-player-btn').disabled = false;
    document.getElementById('loading-status').innerText = "Join a room to play!";
    document.getElementById('copy-container').style.display = 'none';
    document.getElementById('hud').style.display = 'none';
    document.getElementById('my-name-display').innerText = "You";
    document.getElementById('opp-name-display').innerText = "Opp";
    if (ws) ws.close();
}

function startSinglePlayer() {
    playClickSound();
    isSinglePlayer = true;
    document.getElementById('menu-overlay').style.display = 'none';
    document.getElementById('hud').style.display = 'flex';
    document.getElementById('opponent-status').parentNode.style.display = 'none'; // Hide opponent score
    document.getElementById('copy-container').style.display = 'none';
    document.getElementById('my-name-display').innerText = "You";
    requestFullScreen();
    startGame();
}

function requestFullScreen() {
    let elem = document.documentElement;
    try {
        if (elem.requestFullscreen) {
            elem.requestFullscreen().catch(err => console.log("Fullscreen error:", err));
        } else if (elem.webkitRequestFullscreen) { /* Safari */
            elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) { /* IE11 */
            elem.msRequestFullscreen();
        }
    } catch (e) {
        console.log("Fullscreen not supported or blocked");
    }
}

// Ensure fullscreen can be triggered by ANY click once a game starts
document.addEventListener('click', () => {
    if (isPlaying && !document.fullscreenElement && !document.webkitFullscreenElement) {
        requestFullScreen();
    }
});

function createRoom() {
    playClickSound();
    // Generate a random 5-character string
    let newRoomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    joinRoom(newRoomCode, selectedTime, true);
}

function copyRoomCode() {
    playClickSound();
    navigator.clipboard.writeText(roomCode).then(() => {
        let btn = document.getElementById('copy-btn');
        let originalText = btn.innerText;
        btn.innerText = "✓ Copied";
        setTimeout(() => { btn.innerText = originalText; }, 2000);
    }).catch(err => {
        console.error('Could not copy text: ', err);
    });
}

function updateOpponentStatus(data) {
    if (data.players.length === 2) {
        document.getElementById('opponent-status').innerText = "Connected!";
        document.getElementById('opponent-status').style.color = "#27ae60";
        document.getElementById('copy-btn').disabled = true;
        document.getElementById('copy-btn').innerText = "Full";
        document.getElementById('copy-btn').style.opacity = "0.5";
        
        // find opponent score and name
        for (let p of data.players) {
            if (p.id !== playerId) {
                opponentScore = p.score;
                document.getElementById('opponent-score').innerText = opponentScore;
                if (p.name) {
                    document.getElementById('opponent-status').innerText = `Playing: ${p.name}`;
                    document.getElementById('opp-name-display').innerText = p.name;
                }
            } else {
                if (p.name) {
                    document.getElementById('my-name-display').innerText = p.name;
                }
            }
        }
    } else {
        document.getElementById('opponent-status').innerText = "Waiting...";
        document.getElementById('opponent-status').style.color = "#333";
        document.getElementById('copy-btn').disabled = false;
        document.getElementById('copy-btn').innerText = "Copy";
        document.getElementById('copy-btn').style.opacity = "1";
    }
}

function sendScoreUpdate() {
    if (!isSinglePlayer && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "score_update", score: level - 1 }));
    }
}

function startGame() {
    level = 1;
    document.getElementById('lvl').innerText = "0";
    document.getElementById('final-score').innerText = "0";
    
    if (!isSinglePlayer) {
        document.getElementById('leaderboard-panel').style.display = 'none';
    } else {
        document.getElementById('leaderboard-panel').style.display = 'block';
    }
    
    isPlaying = true;
    bgMusic.play().catch(() => { });
    spawnTarget();
    startTimer();
    update();
}

function startTimer() {
    const clock = setInterval(() => {
        if (timeLeft > 0 && isPlaying) {
            timeLeft--;
            document.getElementById('timer').innerText = timeLeft;
            if (timeLeft === 0) {
                bellSound.play();
                isPlaying = false;

                let myScore = level - 1;
                let title = "TIME'S UP!";
                if (!isSinglePlayer && opponentScore !== undefined) {
                    title = myScore > opponentScore ? "YOU WIN!" : (myScore < opponentScore ? "YOU LOSE!" : "DRAW!");
                }
                setTimeout(() => { showGameOver(title, myScore); }, 800);
            }
        } else { clearInterval(clock); }
    }, 1000);
}

function spawnTarget() {
    currentTargetImg = targetImages[Math.floor(Math.random() * targetImages.length)];
    target.size = Math.max(40, 90 - (level * 3));
    target.x = 60 + Math.random() * (canvas.width - target.size - 80);
    target.y = Math.max(30, 250 - (level * 10)) + Math.random() * 80;

    const colors = ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c'];
    target.color = colors[Math.floor(Math.random() * colors.length)];

    // Add horizontal movement for higher levels to make it more interesting!
    target.vx = level > 2 ? (Math.random() > 0.5 ? 1 : -1) * (0.5 + Math.min(level * 0.15, 3.5)) : 0;
}

function resetSharpener() {
    sharpener.active = false; sharpener.vx = 0; sharpener.vy = 0;
    sharpener.x = canvas.width / 2;
    sharpener.y = canvas.height - (canvas.height / 12);
    sharpener.rotation = 0;
}

canvas.addEventListener('mousedown', () => {
    if (!sharpener.active && isPlaying) {
        isDragging = true;
        if (!isMuted) {
            stretchSound.currentTime = 0;
            stretchSound.play().catch(() => { });
        }
    }
});

window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
    mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
    if (isDragging) {
        const dist = Math.hypot(sharpener.x - mouse.x, sharpener.y - mouse.y);
        document.getElementById('power-level').style.height = Math.min(dist / 1.5, 100) + "%";
    }
});

let powerScaleRatio = 1; // Tracks the slowing down factor based on initial power

window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    hasMovedSharpener = true; // Mark that user has interacted
    const dx = sharpener.x - mouse.x, dy = sharpener.y - mouse.y;
    const power = Math.min(Math.hypot(dx, dy), 150) * 0.22;
    const angle = Math.atan2(dy, dx);
    sharpener.vx = Math.cos(angle) * power;
    sharpener.vy = Math.sin(angle) * power;
    sharpener.active = true;

    // Calculate a friction multiplier. Higher power = less friction = slides further
    // A standard throw might have power ~15. 
    // We map the power to a friction ratio between 0.95 (strong drag) and 0.99 (light drag).
    powerScaleRatio = 0.95 + (power / 33) * 0.04;

    document.getElementById('power-level').style.height = "0%";
});

function update() {
    if (!isPlaying) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // BACKGROUND WIND SHAVINGS LOGIC
    if (Math.random() < 0.002 && !windActive) { // Random chance to start wind
        startWind();
    }

    if (windActive) {
        windTimer--;
        if (windTimer <= 0) windActive = false;

        // Spawn 1-2 shavings per frame
        if (Math.random() < 0.4) {
            let startX = windSpeed > 0 ? -20 : canvas.width + 20;
            windParticles.push({
                x: startX,
                y: Math.random() * canvas.height,
                vx: windSpeed + (Math.random() * 2 - 1),
                vy: (Math.random() * 2 - 1),
                size: Math.random() * 4 + 2,
                color: Math.random() > 0.6 ? '#e67e22' : '#2c3e50', // wood or graphite color
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.4
            });
        }
    }

    // UPDATE & DRAW WIND PARTICLES (Background layer)
    for (let i = windParticles.length - 1; i >= 0; i--) {
        let p = windParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotSpeed;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        // draw a tiny irregular polygon for a shaving
        ctx.beginPath();
        ctx.moveTo(0, -p.size / 2);
        ctx.lineTo(p.size, 0);
        ctx.lineTo(0, p.size / 2);
        ctx.lineTo(-p.size / 2, 0);
        ctx.fill();
        ctx.restore();

        if (p.x < -50 || p.x > canvas.width + 50 || p.y < -50 || p.y > canvas.height + 50) {
            windParticles.splice(i, 1);
        }
    }

    // UPDATE TARGET POSITION & DRAW TARGET
    if (target.vx) {
        target.x += target.vx;
        if (target.x <= 10 || target.x + target.size >= canvas.width - 10) {
            target.vx *= -1; // bounce off walls
        }
    }

    let targetY = target.y + Math.sin(Date.now() / 250) * 6; // bobbing effect
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.ellipse(target.x + target.size / 2, targetY + target.size - 5, target.size / 2.5, target.size / 6, 0, 0, Math.PI * 2);
    ctx.fill();

    if (currentTargetImg && currentTargetImg.complete && currentTargetImg.naturalWidth !== 0) {
        ctx.drawImage(currentTargetImg, target.x, targetY, target.size, target.size);
    } else {
        ctx.fillStyle = target.color || "#e74c3c";
        ctx.fillRect(target.x, targetY, target.size, target.size);
    }

    // SHARPENER LOGIC
    if (sharpener.active) {
        sharpener.x += sharpener.vx; sharpener.y += sharpener.vy;

        // Apply dynamic friction based on launch power
        sharpener.vx *= powerScaleRatio;
        sharpener.vy *= powerScaleRatio;

        // If it slows down too much, stop it
        if (Math.abs(sharpener.vx) < 0.1 && Math.abs(sharpener.vy) < 0.1) {
            resetSharpener();
        }

        sharpener.rotation += (Math.abs(sharpener.vx) + Math.abs(sharpener.vy)) * 0.02;

        // Trail
        particles.push({
            x: sharpener.x, y: sharpener.y,
            vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
            size: Math.random() * 4 + 2, life: 1, color: '#bdc3c7', isTrail: true
        });

        if (sharpener.x > target.x && sharpener.x < target.x + target.size &&
            sharpener.y > targetY && sharpener.y < targetY + target.size) {

            if (!isMuted) {
                thudSound.currentTime = 0;
                thudSound.play().catch(() => { });
            }
            explode(target.x, targetY);
            level++;
            document.getElementById('lvl').innerText = (level - 1);
            spawnTarget(); resetSharpener();

            // Send score to opponent
            sendScoreUpdate();

            // Screen shake
            canvas.style.transform = `translate(${(Math.random() - 0.5) * 12}px, ${(Math.random() - 0.5) * 12}px)`;
            setTimeout(() => canvas.style.transform = 'none', 50);
        }
        if (sharpener.y < -50 || sharpener.y > canvas.height + 50 ||
            sharpener.x < -50 || sharpener.x > canvas.width + 50) resetSharpener();
    }

    // DRAW SHARPENER SHADOW
    ctx.save();
    ctx.translate(sharpener.x + 8, sharpener.y + 12);
    if (sharpener.active) ctx.scale(1.2, 1.2);
    ctx.rotate(sharpener.rotation);
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.fill();
    ctx.restore();

    // DRAW SHARPENER
    ctx.save();
    ctx.translate(sharpener.x, sharpener.y);
    if (sharpener.active) ctx.scale(1.1, 1.1); // pop slightly when in air
    ctx.rotate(sharpener.rotation);
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fillStyle = "white"; ctx.fill();

    if (sharpenerImg.complete && sharpenerImg.naturalWidth !== 0) {
        ctx.drawImage(sharpenerImg, -sharpener.w / 2, -sharpener.h / 2, sharpener.w, sharpener.h);
    } else {
        ctx.fillStyle = "#3498db"; ctx.fillRect(-15, -15, 30, 30);
    }
    ctx.restore();

    // DRAW "USE ME" NOTE IF NOT INTERACTED YET
    if (!hasMovedSharpener && !sharpener.active) {
        ctx.save();
        ctx.translate(sharpener.x + 35, sharpener.y - 30);
        ctx.rotate(15 * Math.PI / 180 + Math.sin(Date.now() / 200) * 0.1);

        // Sticky note background
        ctx.fillStyle = "#f1c40f"; // Yellow sticky
        ctx.beginPath();
        ctx.moveTo(-10, -15);
        ctx.lineTo(50, -15);
        ctx.lineTo(50, 20);
        ctx.lineTo(40, 30); // Folded corner
        ctx.lineTo(-10, 30);
        ctx.closePath();
        ctx.fill();

        // Fold detail
        ctx.fillStyle = "#d4ac0d";
        ctx.beginPath();
        ctx.moveTo(40, 30);
        ctx.lineTo(40, 20);
        ctx.lineTo(50, 20);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1;
        ctx.stroke();

        // "Use Me!" Text
        ctx.fillStyle = "#333";
        ctx.font = "bold 14px 'Handlee', cursive";
        ctx.fillText("use", -2, 2);
        ctx.fillText("me!", -2, 18);

        ctx.restore();
    }

    // TRAJECTORY LINE AND DRAG LINE
    if (isDragging) {
        ctx.beginPath(); ctx.moveTo(sharpener.x, sharpener.y);
        ctx.lineTo(mouse.x, mouse.y); ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.stroke();
        ctx.setLineDash([]); ctx.lineWidth = 1;

        const dx = sharpener.x - mouse.x, dy = sharpener.y - mouse.y;
        const powerToUse = Math.min(Math.hypot(dx, dy), 150) * 0.22;
        const angle = Math.atan2(dy, dx);
        const tvx = Math.cos(angle) * powerToUse;
        const tvy = Math.sin(angle) * powerToUse;

        ctx.fillStyle = "rgba(231, 76, 60, 0.7)";
        for (let i = 1; i <= 6; i++) {
            let tx = sharpener.x + tvx * (i * 3);
            let ty = sharpener.y + tvy * (i * 3);
            ctx.beginPath(); ctx.arc(tx, ty, 4 - (i * 0.4), 0, Math.PI * 2); ctx.fill();
        }
    }

    // DRAW PARTICLES
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx; p.y += p.vy;
        if (!p.isTrail) p.vy += 0.4;
        p.life -= p.isTrail ? 0.05 : 0.02;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size);
        if (p.life <= 0) particles.splice(i, 1);
    }
    ctx.globalAlpha = 1.0;

    // DRAW FLOATING TEXTS
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
        let ft = floatingTexts[i];
        ft.y += ft.vy; ft.life -= 0.02;
        ctx.globalAlpha = Math.max(0, ft.life);
        ctx.fillStyle = "#27ae60"; ctx.font = "bold 28px 'Handlee', cursive";
        ctx.fillText(ft.text, ft.x - 15, ft.y);
        if (ft.life <= 0) floatingTexts.splice(i, 1);
    }
    ctx.globalAlpha = 1.0;

    requestAnimationFrame(update);
}

init();

// --- LEADERBOARD LOGIC ---
let playerNameCache = null;

function fetchLeaderboard(timeMode) {
    if (!document.getElementById('leaderboard-list')) return;

    // Update active button
    document.querySelectorAll('#leaderboard-panel .time-btn').forEach(b => b.classList.remove('active'));
    let activeBtn = document.getElementById(`lb-btn-${timeMode}`);
    if (activeBtn) activeBtn.classList.add('active');

    document.getElementById('leaderboard-list').innerHTML = "Loading...";

    fetch(`/leaderboard`)
        .then(response => response.json())
        .then(data => {
            let html = "<ol style='padding-left: 20px; margin-top: 5px;'>";
            if (data[timeMode] && data[timeMode].length > 0) {
                data[timeMode].forEach(entry => {
                    html += `<li style='margin-bottom: 5px; border-bottom: 1px dotted rgba(0,0,0,0.1); padding-bottom: 5px;'>
                                <b>${entry.name}</b>: ${entry.score} pts
                             </li>`;
                });
            } else {
                html += "<i>No scores yet! Be the first!</i>";
            }
            html += "</ol>";
            document.getElementById('leaderboard-list').innerHTML = html;
        })
        .catch(err => {
            console.error("Leaderboard fetch error:", err);
            document.getElementById('leaderboard-list').innerHTML = "Failed to load scores.";
        });
}

function submitScore(timeMode, score) {
    if (score <= 0) return; // Don't submit 0 points
    if (!isSinglePlayer) return; // Don't submit multiplayer scores to the global leaderboard

    let menuName = document.getElementById('player-name-input').value.trim();
    if (menuName) {
        playerNameCache = menuName;
    }

    if (!playerNameCache) {
        playerNameCache = prompt("Enter your name for the leaderboard:", "Player");
        if (!playerNameCache) playerNameCache = "Anonymous";
    }

    fetch('/leaderboard', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ name: playerNameCache, score: score, time: timeMode })
    })
        .then(() => fetchLeaderboard(timeMode)) // Refresh leaderboard immediately
        .catch(err => console.error("Leaderboard submit error:", err));
}

function showErrorBox(msg) {
    document.getElementById('error-message').innerText = msg;
    document.getElementById('error-overlay').style.display = 'flex';
}
