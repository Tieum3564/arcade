(() => {
'use strict';
const GAME_ID = 'neon-invaders';
const pilotName = Arcade.requireUser();
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const GROUND_Y = H - 67; // ship's home line; invaders reaching it count as an invasion
const $ = id => document.getElementById(id);
const ui = { score:$('score'), high:$('high'), level:$('level'), lives:$('lives'), weapon:$('weapon'), bossWrap:$('bossWrap'), bossBar:$('bossBar'), toast:$('toast') };
const overlays = { start:$('startOverlay'), pause:$('pauseOverlay'), over:$('gameOverOverlay'), menu:$('gameMenuOverlay') };

let state = 'menu', last = 0, score = 0, level = 1, lives = 3, multiplier = 1, combo = 0;
let highScore = 0;
// Sends the current run to the leaderboard; resolves to the server result ({record, best, rank}), {queued} or null
function saveScore() {
  return Arcade.submitScore(GAME_ID, score, { level })
    .then(r => { if (r && r.best) { highScore = Math.max(highScore, r.best); updateHUD(); } return r; })
    .catch(() => null);
}
let player, invaders = [], bullets = [], enemyBullets = [], particles = [], powerups = [], shields = [], stars = [], boss = null;
let fleetDir = 1, enemyShootClock = 0, levelClock = 0, screenShake = 0, bgHue = 195, shootingStars = [], nebulaTime = 0, obstacles = [], obstacleClock = 1.6, travelSpeed = 85;
const keys = Object.create(null);
const audio = { ctx:null };

function tone(freq=440, duration=.05, type='square', volume=.025, slide=0) {
  try {
    if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = audio.ctx.currentTime, o = audio.ctx.createOscillator(), g = audio.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, now); o.frequency.linearRampToValueAtTime(Math.max(40, freq+slide), now+duration);
    g.gain.setValueAtTime(volume, now); g.gain.exponentialRampToValueAtTime(.0001, now+duration);
    o.connect(g); g.connect(audio.ctx.destination); o.start(now); o.stop(now+duration);
  } catch(e) {}
}

function resetPlayer() {
  player = { x:W/2-24, y:GROUND_Y, w:48, h:27, speed:360, cooldown:0, rapid:0, spread:0, shield:0, invuln:1.5 };
}
function makeStars() {
  stars = Array.from({length:170}, () => ({x:Math.random()*W,y:Math.random()*H,z:Math.random()*2+.3,s:Math.random()*1.8+.4,tw:Math.random()*6.28,drift:(Math.random()-.5)*5}));
}
function startGame() {
  score=0; level=1; lives=3; multiplier=1; combo=0; bullets=[]; enemyBullets=[]; particles=[]; powerups=[]; obstacles=[]; obstacleClock=1.6; boss=null;
  resetPlayer(); makeStars(); setupLevel(); state='playing';
  Object.values(overlays).forEach(o=>o.classList.add('hidden')); updateHUD(); last=performance.now();
  $('gameMenuBtn').classList.add('visible');
    if(audio.ctx && audio.ctx.state==='suspended') audio.ctx.resume();
}
function setupLevel() {
  invaders=[]; bullets=[]; enemyBullets=[]; powerups=[]; shields=[]; boss=null; fleetDir=1; enemyShootClock=0; levelClock=0;
  bgHue = (190 + level*24) % 360;
  if (level % 5 === 0) {
    boss = {x:W/2-90,y:105,w:180,h:72,hp:65+level*13,maxHp:65+level*13,vx:115+level*3,phase:0,shoot:1.1,flash:0};
    ui.bossWrap.style.display='block'; toast(`Level ${level}<br>Boss wave`);
  } else {
    const rows=Math.min(3+Math.floor(level/2),6), cols=Math.min(7+Math.floor(level/3),11);
    const gapX=58, gapY=45, startX=(W-(cols-1)*gapX)/2-18;
    for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) {
      const type = r===0 ? 2 : r<3 ? 1 : 0;
      invaders.push({x:startX+c*gapX,y:105+r*gapY,w:36,h:25,type,hp:type===2&&level>6?2:1,phase:Math.random()*6.28,flash:0});
    }
    createShields(); ui.bossWrap.style.display='none'; toast(`Level ${level}`);
  }
  updateHUD();
}
function createShields() {
  if(level>10) return;
  for(let i=0;i<4;i++) {
    const sx=128+i*235;
    for(let r=0;r<3;r++) for(let c=0;c<7;c++) if(!(r===2&&c>1&&c<5)) shields.push({x:sx+c*8,y:H-137+r*8,w:8,h:8,hp:Math.max(1,4-Math.floor(level/4))});
  }
}
function nextLevel() {
  level++; score += 500*level; player.rapid=Math.max(player.rapid,1.8); setupLevel();
}
function updateHUD() {
  ui.score.textContent=score.toLocaleString(); ui.high.textContent=highScore.toLocaleString(); ui.level.textContent=level; ui.lives.textContent=lives;
  ui.weapon.textContent=player ? (player.spread>0?'Spread':player.rapid>0?'Rapid':'Pulse') : 'Pulse';
  if(boss) ui.bossBar.style.width=`${Math.max(0,boss.hp/boss.maxHp*100)}%`;
}
function toast(text) { ui.toast.innerHTML=text; ui.toast.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>ui.toast.classList.remove('show'),1200); }
function shoot() {
  if(state!=='playing'||player.cooldown>0) return;
  const speed=-620;
  if(player.spread>0) [-.18,0,.18].forEach(a=>bullets.push({x:player.x+player.w/2-2,y:player.y-7,w:4,h:13,vx:Math.sin(a)*230,vy:speed*Math.cos(a),power:1}));
  else bullets.push({x:player.x+player.w/2-2,y:player.y-7,w:4,h:13,vx:0,vy:speed,power:1});
  player.cooldown=player.rapid>0?.105:.24; tone(640,.045,'square',.022,-150);
}
function enemyShoot(x,y,kind=0) {
  if(kind===1) {
    const ang=Math.atan2(player.y-y, player.x+player.w/2-x), s=190+level*5;
    enemyBullets.push({x,y,w:7,h:14,vx:Math.cos(ang)*s,vy:Math.sin(ang)*s,color:'#fb7185'});
  } else enemyBullets.push({x,y,w:5,h:13,vx:0,vy:190+level*10,color:'#fbbf24'});
  tone(180,.08,'sawtooth',.012,-50);
}
function hit(a,b) { return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y; }
function explode(x,y,color='#22d3ee',n=15) {
  for(let i=0;i<n;i++){const a=Math.random()*6.283,s=Math.random()*170+30;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:Math.random()*.55+.25,max:.8,size:Math.random()*3+1,color});}
}
function dropPower(x,y) {
  if(Math.random()>.13) return;
  const types=['rapid','spread','shield','life']; const type=types[Math.floor(Math.random()*types.length)];
  powerups.push({x:x-10,y,w:20,h:20,vy:88,type,spin:0});
}
function damagePlayer() {
  if(player.invuln>0) return;
  if(player.shield>0) { player.shield=0; player.invuln=.5; explode(player.x+24,player.y+12,'#60a5fa',24); tone(260,.15,'sine',.04,-100); return; }
  lives--; combo=0; multiplier=1; screenShake=15; explode(player.x+24,player.y+14,'#f43f5e',35); tone(110,.45,'sawtooth',.06,-60);
  if(lives<=0) endGame(false); else { resetPlayer(); toast(`${lives} ${lives===1?'life':'lives'} remaining`); }
  updateHUD();
}
function endGame(won) {
  state='over'; $('gameMenuBtn').classList.remove('visible'); $('gameMenuOverlay').classList.add('hidden'); ui.bossWrap.style.display='none';
  $('endTitle').textContent=won?'Galaxy saved!':'Mission failed';
  $('endText').innerHTML=`Final score: <b>${score.toLocaleString()}</b><br>Reached level ${level}.<br><span class="saveInfo">${score>0?'Saving score…':''}</span>`;
  const saveInfo=$('endText').querySelector('.saveInfo');
  saveScore().then(r=>{
    if(!r){saveInfo.textContent=score>0?'Score could not be saved.':'';return;}
    if(r.queued){saveInfo.textContent='Server unreachable – score will be sent later.';return;}
    saveInfo.innerHTML=(r.record?'<b class="accent">★ New personal record! ★</b><br>':'')+`Leaderboard rank: <b>#${Number(r.rank)||'?'}</b>`;
  });
  overlays.over.classList.remove('hidden'); updateHUD();
}
function addScore(base) {
  combo++; if(combo%8===0) multiplier=Math.min(5,multiplier+1); score += base*multiplier; if(score>highScore) highScore=score; updateHUD();
}

function update(dt) {
  nebulaTime += dt;
  stars.forEach(s=>{s.y+=s.z*(55+level*3+(player&&state==='playing'?(H-player.y)*.12:0))*dt;s.x+=s.drift*dt;s.tw+=dt*(1+s.z);if(s.y>H){s.y=0;s.x=Math.random()*W;}if(s.x<0)s.x=W;if(s.x>W)s.x=0;});
  if(Math.random()<dt*.16) shootingStars.push({x:Math.random()*W*.7,y:Math.random()*H*.28,vx:420+Math.random()*180,vy:180+Math.random()*90,life:.75,max:.75});
  shootingStars.forEach(m=>{m.x+=m.vx*dt;m.y+=m.vy*dt;m.life-=dt;});
  shootingStars=shootingStars.filter(m=>m.life>0&&m.x<W+100&&m.y<H+100);
  if(state!=='playing') return;
  levelClock+=dt; screenShake=Math.max(0,screenShake-45*dt);
  const keyX=(keys.ArrowRight||keys.KeyD?1:0)-(keys.ArrowLeft||keys.KeyA?1:0);
  const keyY=(keys.ArrowDown||keys.KeyS?1:0)-(keys.ArrowUp||keys.KeyW?1:0);
  const moveX=Math.max(-1,Math.min(1,keyX+joyX));
  const moveY=Math.max(-1,Math.min(1,keyY+joyY));
  player.x=Math.max(8,Math.min(W-player.w-8,player.x+moveX*player.speed*dt));
  player.y=Math.max(125,Math.min(H-player.h-18,player.y+moveY*player.speed*.82*dt));
  // Obstacles stream toward the pilot to create a forward-flight illusion.
  obstacleClock-=dt;
  if(obstacleClock<=0){
    // Pseudo-3D asteroid: z=1 is far away, z=0 is at the player's plane.
    // World offsets are projected outward from a vanishing point as z decreases.
    obstacles.push({wx:(Math.random()-.5)*1.7,wy:(Math.random()-.5)*1.15,z:1,r:18+Math.random()*29,rot:Math.random()*6.28,vr:(Math.random()-.5)*1.8,shape:Math.floor(Math.random()*3),hit:false});
    obstacleClock=Math.max(.50,1.65-level*.032)*(0.72+Math.random()*.65);
  }
  const thrust=Math.max(-1,Math.min(1,(keys.ArrowUp||keys.KeyW?1:0)-(keys.ArrowDown||keys.KeyS?1:0)-joyY));
  const depthRate=.20+level*.008+thrust*.07;
  const vpX=W/2, vpY=H*.28;
  obstacles.forEach(o=>{
    o.z-=depthRate*dt;o.rot+=o.vr*dt;
    const near=1-Math.max(0,o.z), perspective=.10+near*near*1.08;
    o.scale=.16+near*near*1.72;
    o.x=vpX+o.wx*W*.62*perspective;
    o.y=vpY+o.wy*H*.58*perspective+near*H*.43;
    o.pr=o.r*o.scale;
  });
  // Only near-plane asteroids can collide, preventing visually distant rocks from causing damage.
  for(const o of obstacles) if(!o.hit&&o.z<.20&&o.z>-.10){const cx=Math.max(player.x,Math.min(o.x,player.x+player.w)),cy=Math.max(player.y,Math.min(o.y,player.y+player.h)),dx=o.x-cx,dy=o.y-cy;if(dx*dx+dy*dy<o.pr*o.pr){o.hit=true;damagePlayer();}}
  obstacles=obstacles.filter(o=>!o.hit&&o.z>-.18&&o.pr<180);
  player.cooldown-=dt; player.invuln-=dt; player.rapid-=dt; player.spread-=dt;
  if(keys.Space) shoot();

  bullets.forEach(b=>{b.x+=b.vx*dt;b.y+=b.vy*dt;});
  enemyBullets.forEach(b=>{b.x+=b.vx*dt;b.y+=b.vy*dt;});
  powerups.forEach(p=>{p.y+=p.vy*dt;p.spin+=dt*5;});
  particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=55*dt;p.life-=dt;});
  bullets=bullets.filter(b=>b.y>-30&&b.x>-30&&b.x<W+30);
  enemyBullets=enemyBullets.filter(b=>b.y<H+30&&b.x>-30&&b.x<W+30);
  particles=particles.filter(p=>p.life>0); powerups=powerups.filter(p=>p.y<H+30);

  for(const p of powerups) if(!p.taken&&hit(p,player)){p.taken=true; if(p.type==='rapid')player.rapid=9;if(p.type==='spread')player.spread=8;if(p.type==='shield')player.shield=1;if(p.type==='life')lives=Math.min(5,lives+1);explode(p.x+10,p.y+10,'#a7f3d0',20);tone(880,.18,'sine',.04,400);toast(p.type==='life'?'+1 Life':p.type);updateHUD();}
  powerups=powerups.filter(p=>!p.taken);

  if(boss) updateBoss(dt); else updateFleet(dt);

  for(const eb of enemyBullets) {
    if(!eb.dead&&hit(eb,player)){eb.dead=true;damagePlayer();}
    for(const s of shields) if(s.hp>0&&!eb.dead&&hit(eb,s)){eb.dead=true;s.hp--;explode(eb.x,eb.y,'#7dd3fc',4);}
  }
  for(const b of bullets) for(const s of shields) if(s.hp>0&&!b.dead&&hit(b,s)){b.dead=true;s.hp--;}
  enemyBullets=enemyBullets.filter(b=>!b.dead); bullets=bullets.filter(b=>!b.dead); shields=shields.filter(s=>s.hp>0);
}

function updateFleet(dt) {
  if(!invaders.length){nextLevel();return;}
  const speed=(27+level*8)*(1.15-invaders.length/120), dx=fleetDir*speed*dt;
  let turn=false;
  invaders.forEach(v=>{v.x+=dx;v.phase+=dt*3;v.flash-=dt;if(v.x<15||v.x+v.w>W-15)turn=true;});
  if(turn){fleetDir*=-1;invaders.forEach(v=>{v.x+=fleetDir*speed*dt*2;v.y+=12+level*.7;});tone(90,.035,'square',.01);}
  enemyShootClock-=dt;
  if(enemyShootClock<=0){
    const shooters=invaders.filter(a=>!invaders.some(b=>Math.abs(b.x-a.x)<20&&b.y>a.y));
    const chosen=shooters[Math.floor(Math.random()*shooters.length)]; if(chosen)enemyShoot(chosen.x+chosen.w/2,chosen.y+chosen.h,Math.random()<.22?1:0);
    enemyShootClock=Math.max(.3,1.24-level*.055)*(.7+Math.random());
  }
  for(const b of bullets) for(const v of invaders) if(!b.dead&&!v.dead&&hit(b,v)){
    b.dead=true;v.hp--;v.flash=.1;if(v.hp<=0){v.dead=true;addScore((v.type+1)*30);dropPower(v.x+v.w/2,v.y);explode(v.x+v.w/2,v.y+v.h/2,['#86efac','#fbbf24','#f472b6'][v.type],13);tone(300+v.type*100,.07,'square',.025,150);}
  }
  invaders=invaders.filter(v=>!v.dead);
  // Ramming an invader costs a life (or the shield) and destroys it
  if(player.invuln<=0) for(const v of invaders) if(hit(v,player)){
    v.dead=true;explode(v.x+v.w/2,v.y+v.h/2,['#86efac','#fbbf24','#f472b6'][v.type],13);damagePlayer();break;
  }
  invaders=invaders.filter(v=>!v.dead);
  if(state!=='playing') return;
  // Invasion: the fleet reached the ground line (fixed, independent of where the ship flies)
  if(invaders.some(v=>v.y+v.h>GROUND_Y)){
    const shift=Math.min(...invaders.map(v=>v.y))-105;
    invaders.forEach(v=>v.y-=shift);
    enemyBullets=[];
    toast('Invasion repelled<br>-1 life');
    lives--;combo=0;multiplier=1;screenShake=15;tone(110,.45,'sawtooth',.06,-60);
    if(lives<=0) endGame(false); else resetPlayer();
    updateHUD();
  }
}

function updateBoss(dt) {
  boss.phase+=dt;boss.flash-=dt;boss.x+=boss.vx*dt;if(boss.x<35||boss.x+boss.w>W-35){boss.vx*=-1;boss.x=Math.max(35,Math.min(W-35-boss.w,boss.x));}
  boss.y=100+Math.sin(boss.phase*1.6)*25;boss.shoot-=dt;
  if(boss.shoot<=0){
    const mode=Math.floor(boss.phase)%3;
    if(mode===0) for(let i=-2;i<=2;i++) enemyBullets.push({x:boss.x+boss.w/2,y:boss.y+boss.h,w:7,h:14,vx:i*58,vy:195+level*6,color:'#f43f5e'});
    else {enemyShoot(boss.x+35,boss.y+boss.h,1);enemyShoot(boss.x+boss.w-35,boss.y+boss.h,1);}
    boss.shoot=Math.max(.42,1.08-level*.025);tone(130,.12,'sawtooth',.02,-20);
  }
  for(const b of bullets) if(!b.dead&&hit(b,boss)){b.dead=true;boss.hp-=b.power;boss.flash=.08;addScore(12);explode(b.x,b.y,'#fda4af',4);}
  ui.bossBar.style.width=`${Math.max(0,boss.hp/boss.maxHp*100)}%`;
  if(boss.hp<=0){score+=2500*level;explode(boss.x+boss.w/2,boss.y+boss.h/2,'#fb7185',100);tone(80,.8,'sawtooth',.07,800);boss=null;ui.bossWrap.style.display='none';setTimeout(()=>{if(state==='playing')nextLevel();},800);}
  else if(hit(boss,player)) damagePlayer();
}

function draw() {
  ctx.save();
  const sx=screenShake?(Math.random()-.5)*screenShake:0, sy=screenShake?(Math.random()-.5)*screenShake:0;ctx.translate(sx,sy);
  const grad=ctx.createRadialGradient(W/2,H*.45,10,W/2,H*.45,H*.8);grad.addColorStop(0,`hsla(${bgHue},70%,16%,1)`);grad.addColorStop(1,'#020617');ctx.fillStyle=grad;ctx.fillRect(-20,-20,W+40,H+40);
  // Slowly moving nebula clouds give the battlefield depth without affecting gameplay.
  ctx.save();ctx.globalCompositeOperation='screen';
  const nx=W*.5+Math.sin(nebulaTime*.10)*W*.24, ny=H*.40+Math.cos(nebulaTime*.08)*H*.15;
  let ng=ctx.createRadialGradient(nx,ny,0,nx,ny,260);ng.addColorStop(0,`hsla(${(bgHue+45)%360},85%,48%,.10)`);ng.addColorStop(.45,`hsla(${bgHue},80%,35%,.05)`);ng.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=ng;ctx.fillRect(0,0,W,H);
  const nx2=W*.22+Math.cos(nebulaTime*.07)*110, ny2=H*.65+Math.sin(nebulaTime*.09)*80;
  ng=ctx.createRadialGradient(nx2,ny2,0,nx2,ny2,190);ng.addColorStop(0,'rgba(168,85,247,.07)');ng.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=ng;ctx.fillRect(0,0,W,H);ctx.restore();
  ctx.fillStyle='#dff8ff';stars.forEach(s=>{ctx.globalAlpha=Math.min(1,.25+s.z/2)*(.68+.32*Math.sin(s.tw));ctx.fillRect(s.x,s.y,s.s,s.s);});ctx.globalAlpha=1;
  shootingStars.forEach(m=>{ctx.save();ctx.globalAlpha=Math.max(0,m.life/m.max);const mg=ctx.createLinearGradient(m.x,m.y,m.x-m.vx*.13,m.y-m.vy*.13);mg.addColorStop(0,'#e0faff');mg.addColorStop(1,'rgba(34,211,238,0)');ctx.strokeStyle=mg;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(m.x,m.y);ctx.lineTo(m.x-m.vx*.13,m.y-m.vy*.13);ctx.stroke();ctx.restore();});
  drawGrid();
  obstacles.forEach(drawObstacle);
  shields.forEach(s=>{ctx.fillStyle=`rgba(56,189,248,${.25+s.hp*.18})`;ctx.fillRect(s.x,s.y,s.w-1,s.h-1);});
  invaders.forEach(drawInvader); if(boss)drawBoss();
  powerups.forEach(drawPowerup); bullets.forEach(drawBullet);enemyBullets.forEach(drawEnemyBullet);particles.forEach(drawParticle);
  if(player&&state!=='menu')drawPlayer();
  if(multiplier>1&&state==='playing'){ctx.fillStyle='#facc15';ctx.font='800 16px system-ui';ctx.textAlign='right';ctx.fillText(`COMBO x${multiplier}`,W-18,94);}
  ctx.restore();
}
function drawGrid(){ctx.save();ctx.strokeStyle=`hsla(${bgHue},70%,55%,.07)`;ctx.lineWidth=1;for(let y=120;y<H;y+=42){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}ctx.restore();}
function drawObstacle(o){
  if(!o.pr||o.pr<1)return;
  ctx.save();
  const alpha=Math.min(1,.22+(1-Math.max(0,o.z))*.95);ctx.globalAlpha=alpha;
  // A subtle radial speed streak grows as the asteroid approaches.
  if(o.z<.55){const vx=o.x-W/2,vy=o.y-H*.28,len=(1-o.z)*24;const mag=Math.hypot(vx,vy)||1;ctx.strokeStyle=`rgba(148,163,184,${(1-o.z)*.20})`;ctx.lineWidth=Math.max(1,o.scale*1.4);ctx.beginPath();ctx.moveTo(o.x-vx/mag*len,o.y-vy/mag*len);ctx.lineTo(o.x,o.y);ctx.stroke();}
  ctx.translate(o.x,o.y);ctx.rotate(o.rot);ctx.shadowBlur=7+o.scale*10;ctx.shadowColor='#94a3b8';
  const r=o.pr,g=ctx.createRadialGradient(-r*.35,-r*.35,2,0,0,r);g.addColorStop(0,'#cbd5e1');g.addColorStop(.28,'#64748b');g.addColorStop(.68,'#334155');g.addColorStop(1,'#0f172a');ctx.fillStyle=g;
  ctx.beginPath();const n=10;for(let i=0;i<n;i++){const a=i/n*6.283,rr=r*(.78+.20*Math.sin(i*4.31+o.shape));const x=Math.cos(a)*rr,y=Math.sin(a)*rr;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();ctx.fill();
  ctx.fillStyle='#111827aa';ctx.beginPath();ctx.arc(-r*.25,r*.13,r*.17,0,6.283);ctx.fill();ctx.beginPath();ctx.arc(r*.27,-r*.19,r*.12,0,6.283);ctx.fill();
  ctx.strokeStyle='rgba(226,232,240,.18)';ctx.lineWidth=Math.max(1,o.scale);ctx.beginPath();ctx.arc(0,0,r*.88,3.4,5.7);ctx.stroke();ctx.restore();
}
function drawPlayer(){
  if(player.invuln>0&&Math.floor(player.invuln*12)%2===0)return;ctx.save();ctx.translate(player.x,player.y);
  ctx.shadowBlur=21;ctx.shadowColor='#22d3ee';ctx.fillStyle='#67e8f9';ctx.beginPath();ctx.moveTo(24,0);ctx.lineTo(47,24);ctx.lineTo(34,21);ctx.lineTo(29,27);ctx.lineTo(19,27);ctx.lineTo(14,21);ctx.lineTo(1,24);ctx.closePath();ctx.fill();
  ctx.fillStyle='#082f49';ctx.fillRect(20,10,8,10);ctx.fillStyle='#f59e0b';ctx.fillRect(18,27,5,Math.random()*8+5);ctx.fillRect(26,27,5,Math.random()*8+5);
  if(player.shield){ctx.strokeStyle='#60a5fa';ctx.lineWidth=3;ctx.beginPath();ctx.arc(24,14,34,0,6.283);ctx.stroke();}ctx.restore();
}
function drawInvader(v){
  ctx.save();ctx.translate(v.x,v.y+Math.sin(v.phase)*2);const colors=['#86efac','#fbbf24','#f472b6'];ctx.fillStyle=v.flash>0?'white':colors[v.type];ctx.shadowBlur=12;ctx.shadowColor=colors[v.type];
  const p=v.type===2?[[5,0,31,0],[0,7,36,7],[6,14,30,14],[0,21,8,21],[28,21,36,21]]:v.type===1?[[9,0,27,0],[3,7,33,7],[0,14,36,14],[7,21,14,21],[22,21,29,21]]:[[5,0,12,0],[24,0,31,0],[0,7,36,7],[5,14,31,14],[10,21,15,21],[21,21,26,21]];
  p.forEach(a=>ctx.fillRect(a[0],a[1],a[2]-a[0],6));ctx.fillStyle='#07111e';ctx.fillRect(9,9,5,5);ctx.fillRect(23,9,5,5);ctx.restore();
}
function drawBoss(){ctx.save();ctx.translate(boss.x,boss.y);ctx.shadowBlur=24;ctx.shadowColor='#fb7185';ctx.fillStyle=boss.flash>0?'white':'#f43f5e';ctx.beginPath();ctx.moveTo(20,10);ctx.lineTo(70,0);ctx.lineTo(110,0);ctx.lineTo(160,10);ctx.lineTo(180,48);ctx.lineTo(144,68);ctx.lineTo(36,68);ctx.lineTo(0,48);ctx.closePath();ctx.fill();ctx.fillStyle='#310717';ctx.fillRect(45,24,90,24);ctx.fillStyle='#fda4af';for(let i=0;i<5;i++)ctx.fillRect(57+i*18,31,8,9);ctx.restore();}
function drawBullet(b){ctx.save();ctx.shadowBlur=13;ctx.shadowColor='#67e8f9';ctx.fillStyle='#d5fbff';ctx.fillRect(b.x,b.y,b.w,b.h);ctx.restore();}
function drawEnemyBullet(b){ctx.save();ctx.shadowBlur=11;ctx.shadowColor=b.color;ctx.fillStyle=b.color;ctx.fillRect(b.x,b.y,b.w,b.h);ctx.restore();}
function drawParticle(p){ctx.save();ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size);ctx.restore();}
function drawPowerup(p){const colors={rapid:'#facc15',spread:'#c084fc',shield:'#60a5fa',life:'#4ade80'};ctx.save();ctx.translate(p.x+10,p.y+10);ctx.rotate(p.spin);ctx.shadowBlur=16;ctx.shadowColor=colors[p.type];ctx.strokeStyle=colors[p.type];ctx.lineWidth=3;ctx.strokeRect(-8,-8,16,16);ctx.fillStyle=colors[p.type];ctx.font='bold 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText({rapid:'R',spread:'S',shield:'D',life:'+'}[p.type],0,0);ctx.restore();}

function loop(t){const dt=Math.min(.033,(t-last)/1000||0);last=t;update(dt);draw();requestAnimationFrame(loop);}
function resetTouchInput(){keys.Space=false;joyX=joyY=0;if(joystickKnob)joystickKnob.style.transform='translate(0,0)';}
  function openGameMenu(){if(state!=='playing')return;state='menuPaused';resetTouchInput();$('gameMenuOverlay').classList.remove('hidden');}
  function resumeGameMenu(){if(state!=='menuPaused')return;$('gameMenuOverlay').classList.add('hidden');state='playing';last=performance.now();}
  function endFromMenu(){
    if(state!=='menuPaused')return;
    $('gameMenuOverlay').classList.add('hidden');
    saveScore();
    state='menu';$('gameMenuBtn').classList.remove('visible');ui.bossWrap.style.display='none';
    $('instructionsPanel').classList.add('hidden');$('mainMenu').classList.remove('hidden');overlays.start.classList.remove('hidden');updateHUD();
  }
  function togglePause(){if(state==='playing'){state='paused';resetTouchInput();overlays.pause.classList.remove('hidden');}else if(state==='paused'){state='playing';overlays.pause.classList.add('hidden');last=performance.now();}}

addEventListener('keydown',e=>{keys[e.code]=true;if(['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code))e.preventDefault();if((e.code==='KeyP'||e.code==='Escape')&&!e.repeat)togglePause();});
addEventListener('keyup',e=>{keys[e.code]=false;});
$('startBtn').addEventListener('click',startGame);$('restartBtn').addEventListener('click',startGame);$('resumeBtn').addEventListener('click',togglePause);
  $('gameMenuBtn').addEventListener('click',openGameMenu);
  $('menuResumeBtn').addEventListener('click',resumeGameMenu);
  $('menuRestartBtn').addEventListener('click',startGame);
  $('menuEndBtn').addEventListener('click',endFromMenu);
  function goHome(){location.href=Arcade.HOME_URL;}
  $('menuHomeBtn').addEventListener('click',()=>{if(state==='menuPaused')saveScore().finally(goHome);else goHome();});
  document.querySelectorAll('.homeBtn').forEach(b=>b.addEventListener('click',goHome));
  $('pilotName').textContent=pilotName||'';
$('instructionsBtn').addEventListener('click',()=>{$('mainMenu').classList.add('hidden');$('instructionsPanel').classList.remove('hidden');});
$('backBtn').addEventListener('click',()=>{$('instructionsPanel').classList.add('hidden');$('mainMenu').classList.remove('hidden');});
function bindHold(id,code){const el=$(id);const on=e=>{e.preventDefault();keys[code]=true;if(code==='Space')shoot();};const off=e=>{e.preventDefault();keys[code]=false;};el.addEventListener('pointerdown',on);el.addEventListener('pointerup',off);el.addEventListener('pointercancel',off);el.addEventListener('pointerleave',off);}
bindHold('fireBtn','Space');
  const joystick=$('joystick'), joystickKnob=$('joystickKnob');
  let joyPointer=null, joyX=0, joyY=0;
  function updateJoystick(e){
    const r=joystick.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2;
    let dx=e.clientX-cx, dy=e.clientY-cy, max=r.width*.32, d=Math.hypot(dx,dy);
    if(d>max){dx=dx/d*max;dy=dy/d*max;}
    joyX=dx/max;joyY=dy/max;
    if(Math.abs(joyX)<.12)joyX=0;if(Math.abs(joyY)<.12)joyY=0;
    joystickKnob.style.transform=`translate(${dx}px,${dy}px)`;
  }
  joystick.addEventListener('pointerdown',e=>{e.preventDefault();joyPointer=e.pointerId;joystick.setPointerCapture(e.pointerId);updateJoystick(e);});
  joystick.addEventListener('pointermove',e=>{if(e.pointerId===joyPointer){e.preventDefault();updateJoystick(e);}});
  function releaseJoystick(e){if(joyPointer===null||e.pointerId===joyPointer){joyPointer=null;joyX=joyY=0;joystickKnob.style.transform='translate(0,0)';}}
  joystick.addEventListener('pointerup',releaseJoystick);joystick.addEventListener('pointercancel',releaseJoystick);
canvas.addEventListener('pointerdown',e=>{e.preventDefault();if(!audio.ctx)tone(1,.01,'sine',.0001);if(e.pointerType!=='mouse'&&state==='playing')shoot();});
  canvas.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});
  document.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});
  document.addEventListener('touchmove',e=>{if(state==='playing')e.preventDefault();},{passive:false});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state==='playing')togglePause();});
makeStars();resetPlayer();ui.high.textContent=highScore.toLocaleString();requestAnimationFrame(loop);
Arcade.ready.then(()=>Arcade.getStats()).then(s=>{const b=s[GAME_ID];if(b){highScore=Math.max(highScore,b.best);updateHUD();}}).catch(()=>{});
})();
