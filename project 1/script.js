/**
 * NULL-G — Anti-Gravity Flight Simulator
 * ========================================
 * Engine: Three.js (WebGL)
 * Physics: Custom vector-based, 6-DoF, momentum with inertia
 * No standard gravity or aerodynamics — pure thrust + field mechanics
 *
 * Architecture:
 *   PhysicsBody    — Manages position, velocity, orientation (Quaternion-based)
 *   GravityField   — Directional gravity wells / push zones in 3D space
 *   Spaceship      — Extends PhysicsBody; handles 6-DoF thrust input
 *   Environment    — Asteroids, floating islands, energy fields, particles
 *   HUDController  — Updates DOM overlay elements
 *   MiniMap        — 2D top-down radar canvas
 *   MissionManager — Checkpoint / race / docking missions
 *   GameLoop       — Three.js animation loop, delta-time physics
 */

'use strict';

/* ================================================================
   CONSTANTS & CONFIGURATION
   ================================================================ */
const CONFIG = {
  // Ship physics
  THRUST_FORCE:         28.0,   // N — base forward thrust
  STRAFE_FORCE:         16.0,   // N — lateral / vertical strafe
  ROTATION_SPEED:       1.2,    // rad/s — angular velocity
  ROLL_SPEED:           1.5,    // rad/s
  INERTIA_DAMPING:      0.985,  // Momentum decay per frame (close to 1 = space-like)
  ANGULAR_DAMPING:      0.88,   // Rotation decay
  BOOST_MULTIPLIER:     2.8,
  BOOST_DRAIN_RATE:     0.4,    // % per second
  BOOST_REGEN_RATE:     0.15,   // % per second
  MAX_SPEED:            120,

  // Gravity fields
  GRAVITY_WELL_STRENGTH: 18.0,  // attraction multiplier
  DANGEROUS_GRAV_DIST:   120,   // warn if closer than this

  // World
  WORLD_BOUNDS:          900,
  WRAP_WORLD:            true,  // wrap ship when it exits bounds

  // Autopilot
  AUTOPILOT_DAMP:        0.05,  // angular correction strength

  // Missions
  CHECKPOINT_RADIUS:     35,
  DOCK_RADIUS:           18,
};

/* ================================================================
   UTILS
   ================================================================ */
const DEG = (r) => r * (180 / Math.PI);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b));

/* Format seconds as MM:SS */
function fmtTime(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/* ================================================================
   PHYSICS BODY — base class for anything with position & velocity
   ================================================================ */
class PhysicsBody {
  constructor(position = new THREE.Vector3()) {
    this.position   = position.clone();
    this.velocity   = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.angularVelocity = new THREE.Vector3();
    this.mass = 1.0;
  }

  /** Apply an impulse force in world space */
  applyForce(force) {
    const accel = force.clone().divideScalar(this.mass);
    this.velocity.add(accel);
  }

  /** Apply torque to change angular velocity */
  applyTorque(torque) {
    this.angularVelocity.add(torque);
  }

  /**
   * Integrate physics over dt seconds.
   * Anti-gravity: no default gravitational acceleration applied.
   */
  integrate(dt, dampingLinear = 1.0, dampingAngular = 1.0) {
    // Clamp max speed
    if (this.velocity.length() > CONFIG.MAX_SPEED) {
      this.velocity.setLength(CONFIG.MAX_SPEED);
    }

    // Update position
    this.position.addScaledVector(this.velocity, dt);

    // Apply inertia damping (simulates very low atmospheric drag in space)
    this.velocity.multiplyScalar(Math.pow(dampingLinear, dt * 60));

    // Update orientation via angular velocity (quaternion integration)
    const dq = new THREE.Quaternion();
    const omega = this.angularVelocity.clone().multiplyScalar(dt * 0.5);
    dq.set(omega.x, omega.y, omega.z, 1).normalize();
    this.quaternion.multiply(dq).normalize();

    // Angular damping
    this.angularVelocity.multiplyScalar(Math.pow(dampingAngular, dt * 60));
  }
}

/* ================================================================
   GRAVITY FIELD — affects all PhysicsBodies in range
   ================================================================ */
class GravityField {
  /**
   * @param {THREE.Vector3} position  World-space center
   * @param {number}        strength  Pull force (positive = attract, negative = repel)
   * @param {number}        radius    Influence radius
   * @param {string}        type      'well' | 'zone' | 'anomaly'
   */
  constructor(position, strength, radius, type = 'well') {
    this.position = position.clone();
    this.strength = strength;
    this.radius   = radius;
    this.type     = type;
    this.mesh     = null; // visual representation
  }

  /**
   * Compute gravitational acceleration vector on a body.
   * Uses inverse-square law scaled to our game feel.
   * Returns a THREE.Vector3 acceleration.
   */
  computeAcceleration(bodyPosition) {
    const toField = this.position.clone().sub(bodyPosition);
    const distSq  = toField.lengthSq();
    const dist    = Math.sqrt(distSq);

    if (dist > this.radius || dist < 0.1) return new THREE.Vector3();

    // Falloff: full strength at center, zero at edge
    const falloff    = 1.0 - (dist / this.radius);
    const accelMag   = this.strength * falloff * falloff; // quadratic falloff

    return toField.normalize().multiplyScalar(accelMag);
  }

  /**
   * Returns pull strength [0..1] and distance for HUD display
   */
  getInfluenceOnBody(bodyPosition) {
    const dist = this.position.distanceTo(bodyPosition);
    if (dist > this.radius) return { pull: 0, dist: Infinity };
    const pull = clamp((1 - dist / this.radius), 0, 1) * Math.abs(this.strength) / CONFIG.GRAVITY_WELL_STRENGTH;
    return { pull: clamp(pull, 0, 1), dist: Math.round(dist) };
  }
}

/* ================================================================
   SPACESHIP — controllable craft with 6-DoF
   ================================================================ */
class Spaceship extends PhysicsBody {
  constructor() {
    super(new THREE.Vector3(0, 0, 0));
    this.mass = 5.0;

    // Thrust state
    this.thrustForward  = 0;   // -1..1
    this.thrustStrafe   = 0;   // -1..1
    this.thrustVertical = 0;   // -1..1
    this.boostFuel      = 100; // 0..100 %
    this.isBoosting     = false;
    this.isStabilizing  = false;
    this.isAutopilot    = false;

    // Rotation inputs
    this.pitchInput = 0;
    this.yawInput   = 0;
    this.rollInput  = 0;

    // Mesh
    this.mesh = null;
    this.engineGlows = [];
  }

  /* ---- Local direction helpers (uses ship's own quaternion) ---- */
  getForward()  { return new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion); }
  getRight()    { return new THREE.Vector3(1, 0,  0).applyQuaternion(this.quaternion); }
  getUp()       { return new THREE.Vector3(0, 1,  0).applyQuaternion(this.quaternion); }

  /** Call each frame; inputs set externally by InputManager */
  update(dt, gravityFields = []) {
    const boost = this.isBoosting && this.boostFuel > 0
      ? CONFIG.BOOST_MULTIPLIER : 1.0;

    // ---- 1. Translational Thrust ----
    // Forces are applied in the ship's LOCAL frame, then transformed to world.
    const fwd = this.getForward();
    const rgt = this.getRight();
    const up  = this.getUp();

    const thrustVec = new THREE.Vector3()
      .addScaledVector(fwd, this.thrustForward  * CONFIG.THRUST_FORCE * boost)
      .addScaledVector(rgt, this.thrustStrafe   * CONFIG.STRAFE_FORCE * boost)
      .addScaledVector(up,  this.thrustVertical * CONFIG.STRAFE_FORCE * boost);

    this.applyForce(thrustVec.multiplyScalar(dt));

    // ---- 2. Rotational Thrust ----
    // Angular velocity in LOCAL ship space (then world-transformed for integration)
    const rotInput = new THREE.Vector3(
      this.pitchInput * CONFIG.ROTATION_SPEED,
      this.yawInput   * CONFIG.ROTATION_SPEED,
      this.rollInput  * CONFIG.ROLL_SPEED
    );
    // Transform to world space
    const worldRotTorque = rotInput.clone().applyQuaternion(this.quaternion);
    this.applyTorque(worldRotTorque.multiplyScalar(dt));

    // ---- 3. Gravity Fields ----
    for (const field of gravityFields) {
      const accel = field.computeAcceleration(this.position);
      this.velocity.addScaledVector(accel, dt);
    }

    // ---- 4. Velocity Stabilizer / Dampener ----
    let linDamp = CONFIG.INERTIA_DAMPING;
    let angDamp = CONFIG.ANGULAR_DAMPING;

    if (this.isStabilizing) {
      // Aggressive damping to kill drift quickly
      linDamp = 0.88;
      angDamp = 0.75;
    }

    // ---- 5. Autopilot: level off angular velocity ----
    if (this.isAutopilot) {
      this.angularVelocity.multiplyScalar(1 - CONFIG.AUTOPILOT_DAMP);
    }

    // ---- 6. Integrate physics ----
    this.integrate(dt, linDamp, angDamp);

    // ---- 7. Boost fuel management ----
    if (this.isBoosting && this.thrustForward > 0) {
      this.boostFuel = Math.max(0, this.boostFuel - CONFIG.BOOST_DRAIN_RATE * dt * 60);
    } else {
      this.boostFuel = Math.min(100, this.boostFuel + CONFIG.BOOST_REGEN_RATE * dt * 60);
    }

    // ---- 8. World wrapping (avoid infinite void) ----
    if (CONFIG.WRAP_WORLD) {
      const B = CONFIG.WORLD_BOUNDS;
      if (this.position.x >  B) this.position.x = -B;
      if (this.position.x < -B) this.position.x =  B;
      if (this.position.y >  B) this.position.y = -B;
      if (this.position.y < -B) this.position.y =  B;
      if (this.position.z >  B) this.position.z = -B;
      if (this.position.z < -B) this.position.z =  B;
    }

    // ---- 9. Sync Three.js mesh ----
    if (this.mesh) {
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.quaternion);
    }

    // Animate engine glow intensity
    const thrustLevel = Math.abs(this.thrustForward);
    this.engineGlows.forEach(light => {
      light.intensity = 0.4 + thrustLevel * boost * 2.5;
    });
  }

  /** Return Euler angles in degrees for HUD */
  getEulerDeg() {
    const e = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
    return {
      pitch: DEG(e.x),
      yaw:   DEG(e.y),
      roll:  DEG(e.z),
    };
  }

  reset() {
    this.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.quaternion.identity();
    this.angularVelocity.set(0, 0, 0);
    this.boostFuel = 100;
  }
}

/* ================================================================
   INPUT MANAGER — Keyboard state
   ================================================================ */
class InputManager {
  constructor() {
    this.keys = {};
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      e.preventDefault(); // prevent scrolling on arrow keys
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
    });
  }
  isDown(code) { return !!this.keys[code]; }
}

/* ================================================================
   HUD CONTROLLER — updates DOM elements
   ================================================================ */
class HUDController {
  constructor() {
    this.els = {
      speed:       document.getElementById('hudSpeed'),
      thrust:      document.getElementById('hudThrust'),
      thrustBar:   document.getElementById('thrustBar'),
      boost:       document.getElementById('hudBoost'),
      boostBar:    document.getElementById('boostBar'),
      vx:          document.getElementById('hudVX'),
      vy:          document.getElementById('hudVY'),
      vz:          document.getElementById('hudVZ'),
      pitch:       document.getElementById('hudPitch'),
      yaw:         document.getElementById('hudYaw'),
      roll:        document.getElementById('hudRoll'),
      gravField:   document.getElementById('hudGravField'),
      gravPull:    document.getElementById('hudGravPull'),
      gravBar:     document.getElementById('gravBar'),
      gravDist:    document.getElementById('hudGravDist'),
      autopilot:   document.getElementById('hudAutopilot'),
      dampen:      document.getElementById('hudDampen'),
      clock:       document.getElementById('hudClock'),
      score:       document.getElementById('hudScore'),
      status:      document.getElementById('statusMsg'),
      mode:        document.getElementById('hudMode'),
      warning:     document.getElementById('warningBanner'),
      missionAlert:document.getElementById('missionAlert'),
      cpArrow:     document.getElementById('checkpointArrow'),
    };
  }

  update(ship, gravFields, elapsedTime, score) {
    const v = ship.velocity;
    const speed = v.length();
    const thrust = Math.abs(ship.thrustForward) * (ship.isBoosting ? CONFIG.BOOST_MULTIPLIER : 1);
    const thrustPct = clamp(thrust / CONFIG.BOOST_MULTIPLIER, 0, 1) * 100;
    const euler = ship.getEulerDeg();

    this.els.speed.textContent     = speed.toFixed(1);
    this.els.thrust.textContent    = thrustPct.toFixed(0) + '%';
    this.els.thrustBar.style.width = thrustPct.toFixed(0) + '%';
    this.els.boost.textContent     = ship.boostFuel.toFixed(0) + '%';
    this.els.boostBar.style.width  = ship.boostFuel.toFixed(0) + '%';

    this.els.vx.textContent = v.x.toFixed(1);
    this.els.vy.textContent = v.y.toFixed(1);
    this.els.vz.textContent = v.z.toFixed(1);

    this.els.pitch.textContent = euler.pitch.toFixed(1) + '°';
    this.els.yaw.textContent   = euler.yaw.toFixed(1) + '°';
    this.els.roll.textContent  = euler.roll.toFixed(1) + '°';

    // Gravity fields — find strongest influence
    let strongest = { pull: 0, dist: Infinity, type: 'NONE' };
    for (const f of gravFields) {
      const infl = f.getInfluenceOnBody(ship.position);
      if (infl.pull > strongest.pull) {
        strongest = { ...infl, type: f.type.toUpperCase() };
      }
    }

    this.els.gravField.textContent = strongest.pull > 0.01 ? strongest.type : 'NONE';
    this.els.gravPull.textContent  = strongest.pull.toFixed(2);
    this.els.gravBar.style.width   = (strongest.pull * 100).toFixed(0) + '%';
    this.els.gravDist.textContent  = strongest.dist < 10000 ? strongest.dist : '∞';

    // Danger warning
    const danger = strongest.dist < CONFIG.DANGEROUS_GRAV_DIST;
    this.els.warning.classList.toggle('hidden', !danger);

    // Systems
    this.els.autopilot.textContent = ship.isAutopilot ? 'ON' : 'OFF';
    this.els.autopilot.className   = 'hud-value ' + (ship.isAutopilot ? 'status-on' : 'status-off');
    this.els.dampen.textContent    = ship.isStabilizing ? 'ON' : 'OFF';
    this.els.dampen.className      = 'hud-value ' + (ship.isStabilizing ? 'status-on' : 'status-off');

    // Time
    this.els.clock.textContent = fmtTime(elapsedTime);
    this.els.score.textContent = score;
  }

  setStatus(msg) { this.els.status.textContent = msg; }
  setMode(mode)  { this.els.mode.textContent   = mode; }

  showMissionAlert(msg, duration = 3000) {
    const el = this.els.missionAlert;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._alertTimer);
    this._alertTimer = setTimeout(() => el.classList.add('hidden'), duration);
  }

  showCheckpointArrow(show) {
    this.els.cpArrow.classList.toggle('hidden', !show);
  }
}

/* ================================================================
   MINI MAP — 2D radar canvas
   ================================================================ */
class MiniMap {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx    = canvasEl.getContext('2d');
    this.size   = canvasEl.width;
    this.scale  = this.size / (CONFIG.WORLD_BOUNDS * 2);
  }

  draw(shipPos, gravFields, checkpoints = []) {
    const ctx = this.ctx;
    const cx = this.size / 2;
    const cy = this.size / 2;
    const r  = this.size / 2;

    // Background
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Fill
    ctx.fillStyle = 'rgba(0,10,30,0.85)';
    ctx.fillRect(0, 0, this.size, this.size);

    // Grid
    ctx.strokeStyle = 'rgba(0,245,255,0.06)';
    ctx.lineWidth = 0.5;
    for (let i = -4; i <= 4; i++) {
      const x = cx + i * (this.size / 8);
      const y = cy + i * (this.size / 8);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.size, y); ctx.stroke();
    }

    // Gravity wells
    for (const f of gravFields) {
      const fx = cx + f.position.x * this.scale;
      const fy = cy - f.position.z * this.scale;
      const fr = Math.max(3, f.radius * this.scale * 0.25);
      const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr * 3);
      grad.addColorStop(0, 'rgba(191,0,255,0.6)');
      grad.addColorStop(1, 'rgba(191,0,255,0)');
      ctx.beginPath();
      ctx.arc(fx, fy, fr * 3, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      // Core
      ctx.beginPath();
      ctx.arc(fx, fy, fr, 0, Math.PI * 2);
      ctx.fillStyle = '#bf00ff';
      ctx.fill();
    }

    // Checkpoints
    for (const cp of checkpoints) {
      const cpx = cx + cp.position.x * this.scale;
      const cpy = cy - cp.position.z * this.scale;
      ctx.beginPath();
      ctx.arc(cpx, cpy, 4, 0, Math.PI * 2);
      ctx.strokeStyle = cp.reached ? '#39ff14' : '#ffd700';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Ship (center dot + heading line)
    const sx = cx + shipPos.x * this.scale;
    const sy = cy - shipPos.z * this.scale;
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#00f5ff';
    ctx.shadowColor = '#00f5ff';
    ctx.shadowBlur  = 8;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Border
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,245,255,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/* ================================================================
   ENVIRONMENT — builds the 3D world
   ================================================================ */
class Environment {
  constructor(scene) {
    this.scene        = scene;
    this.asteroids    = [];
    this.islands      = [];
    this.particles    = null;
    this.gravFields   = [];
    this.anomalyMeshes= [];
    this.checkpoints  = [];
  }

  build() {
    this._buildStarfield();
    this._buildAsteroids();
    this._buildFloatingIslands();
    this._buildGravityWells();
    this._buildEnergyParticles();
    this._buildAnomalies();
  }

  /* ---- Starfield ---- */
  _buildStarfield() {
    const geo = new THREE.BufferGeometry();
    const count = 8000;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      pos[i*3]   = rand(-2000, 2000);
      pos[i*3+1] = rand(-2000, 2000);
      pos[i*3+2] = rand(-2000, 2000);

      // Color variety: white, blue, yellow
      const t = Math.random();
      if (t < 0.6) { col[i*3]=1;    col[i*3+1]=1;    col[i*3+2]=1;   }
      else if (t < 0.8) { col[i*3]=0.6; col[i*3+1]=0.8; col[i*3+2]=1; }
      else { col[i*3]=1; col[i*3+1]=1; col[i*3+2]=0.7; }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));

    const mat = new THREE.PointsMaterial({ size: 1.0, vertexColors: true, transparent: true, opacity: 0.85 });
    this.scene.add(new THREE.Points(geo, mat));
  }

  /* ---- Asteroids ---- */
  _buildAsteroids() {
    const colors = [0x557799, 0x446688, 0x664422, 0x553333, 0x335544];
    const spread = CONFIG.WORLD_BOUNDS * 0.85;

    for (let i = 0; i < 120; i++) {
      const s  = rand(4, 28);
      const geo = new THREE.DodecahedronGeometry(s, randInt(0, 2));
      const mat = new THREE.MeshStandardMaterial({
        color: colors[randInt(0, colors.length)],
        roughness: 0.9,
        metalness: 0.1,
        flatShading: true,
      });

      // Deform vertices slightly for organic look
      const posAttr = geo.attributes.position;
      for (let j = 0; j < posAttr.count; j++) {
        posAttr.setXYZ(j,
          posAttr.getX(j) * rand(0.75, 1.3),
          posAttr.getY(j) * rand(0.75, 1.3),
          posAttr.getZ(j) * rand(0.75, 1.3)
        );
      }
      posAttr.needsUpdate = true;

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread));
      mesh.rotation.set(rand(0, Math.PI*2), rand(0, Math.PI*2), rand(0, Math.PI*2));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.rotSpeed = new THREE.Vector3(rand(-0.004, 0.004), rand(-0.004, 0.004), rand(-0.004, 0.004));
      this.scene.add(mesh);
      this.asteroids.push(mesh);
    }
  }

  /* ---- Floating Islands ---- */
  _buildFloatingIslands() {
    const spread = CONFIG.WORLD_BOUNDS * 0.7;

    for (let i = 0; i < 18; i++) {
      const w = rand(30, 100), h = rand(10, 30), d = rand(30, 100);
      const geo = new THREE.BoxGeometry(w, h, d);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x1a4a2a,
        roughness: 0.8,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread));
      mesh.rotation.set(rand(-0.4, 0.4), rand(0, Math.PI*2), rand(-0.4, 0.4));
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Crystal/energy vein on top
      const crystalGeo = new THREE.CylinderGeometry(2, 6, h * 0.8, 6);
      const crystalMat = new THREE.MeshStandardMaterial({
        color: 0x00ffcc, emissive: 0x00ffcc, emissiveIntensity: 0.6,
        transparent: true, opacity: 0.75,
      });
      const crystal = new THREE.Mesh(crystalGeo, crystalMat);
      crystal.position.y = h * 0.8;
      mesh.add(crystal);

      // Light from crystal
      const pl = new THREE.PointLight(0x00ffcc, 1.2, 80);
      pl.position.copy(crystal.position);
      mesh.add(pl);

      mesh.userData.bobSpeed   = rand(0.4, 0.9);
      mesh.userData.bobAmp     = rand(2, 6);
      mesh.userData.bobOffset  = rand(0, Math.PI * 2);
      mesh.userData.baseY      = mesh.position.y;
      this.scene.add(mesh);
      this.islands.push(mesh);
    }
  }

  /* ---- Gravity Wells ---- */
  _buildGravityWells() {
    const spread = CONFIG.WORLD_BOUNDS * 0.6;

    const wellDefs = [
      { pos: new THREE.Vector3(200, 50, -300),  strength: 14, radius: 260, type: 'well' },
      { pos: new THREE.Vector3(-350, -80, 200), strength: 10, radius: 200, type: 'well' },
      { pos: new THREE.Vector3(100, -200, 400), strength: -8, radius: 180, type: 'anomaly' }, // repulsor
      { pos: new THREE.Vector3(-200, 150, -100),strength: 6,  radius: 150, type: 'zone' },
    ];

    for (const def of wellDefs) {
      const field = new GravityField(def.pos, def.strength, def.radius, def.type);
      this.gravFields.push(field);

      // Visual ring
      const ringGeo = new THREE.TorusGeometry(def.radius * 0.15, 1.2, 8, 60);
      const col = def.strength < 0 ? 0xff4400 : (def.type === 'anomaly' ? 0xbf00ff : 0x4400ff);
      const ringMat = new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: 0.55, wireframe: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(def.pos);
      this.scene.add(ring);

      // Sphere core
      const coreGeo = new THREE.SphereGeometry(def.radius * 0.05, 16, 16);
      const coreMat = new THREE.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: 1.5,
        transparent: true, opacity: 0.8,
      });
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.copy(def.pos);
      this.scene.add(core);

      // Point light
      const pl = new THREE.PointLight(col, 2.5, def.radius * 0.6);
      pl.position.copy(def.pos);
      this.scene.add(pl);

      field.mesh = { ring, core };
    }
  }

  /* ---- Energy Particle System ---- */
  _buildEnergyParticles() {
    const count = 3000;
    const geo   = new THREE.BufferGeometry();
    const pos   = new Float32Array(count * 3);
    const col   = new Float32Array(count * 3);
    const spread = CONFIG.WORLD_BOUNDS;

    for (let i = 0; i < count; i++) {
      pos[i*3]   = rand(-spread, spread);
      pos[i*3+1] = rand(-spread, spread);
      pos[i*3+2] = rand(-spread, spread);

      // Teal / purple / blue particles
      const t = Math.random();
      if (t < 0.5) { col[i*3]=0; col[i*3+1]=0.9; col[i*3+2]=1; }
      else { col[i*3]=0.7; col[i*3+1]=0; col[i*3+2]=1; }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
    this.particlePositions = pos;

    const mat = new THREE.PointsMaterial({
      size: 1.8, vertexColors: true, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);
  }

  /* ---- Spatial Anomalies ---- */
  _buildAnomalies() {
    const animStart = [
      { pos: [400, 100, -200], col: 0x00ffcc },
      { pos: [-300, -150, -350], col: 0xff00aa },
      { pos: [50, 300, 350], col: 0xaaff00 },
    ];

    for (const def of animStart) {
      const geo = new THREE.TorusKnotGeometry(18, 5, 80, 12, 2, 3);
      const mat = new THREE.MeshStandardMaterial({
        color: def.col, emissive: def.col, emissiveIntensity: 0.8,
        transparent: true, opacity: 0.65, wireframe: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...def.pos);
      mesh.userData.rotSpeed = new THREE.Vector3(rand(0.002, 0.006), rand(0.002, 0.007), rand(0.001, 0.004));
      this.scene.add(mesh);
      this.anomalyMeshes.push(mesh);

      // Halo light
      const pl = new THREE.PointLight(def.col, 2, 200);
      pl.position.set(...def.pos);
      this.scene.add(pl);
    }
  }

  /* ---- Animate all environment objects ---- */
  update(t) {
    // Rotate asteroids
    for (const a of this.asteroids) {
      a.rotation.x += a.userData.rotSpeed.x;
      a.rotation.y += a.userData.rotSpeed.y;
      a.rotation.z += a.userData.rotSpeed.z;
    }

    // Bob floating islands
    for (const island of this.islands) {
      island.position.y = island.userData.baseY
        + Math.sin(t * island.userData.bobSpeed + island.userData.bobOffset)
        * island.userData.bobAmp;
    }

    // Rotate gravity well rings
    for (const f of this.gravFields) {
      if (f.mesh) {
        f.mesh.ring.rotation.x += 0.005;
        f.mesh.ring.rotation.y += 0.008;
        f.mesh.core.material.emissiveIntensity = 1.0 + Math.sin(t * 2) * 0.5;
      }
    }

    // Rotate anomalies
    for (const a of this.anomalyMeshes) {
      a.rotation.x += a.userData.rotSpeed.x;
      a.rotation.y += a.userData.rotSpeed.y;
      a.rotation.z += a.userData.rotSpeed.z;
    }

    // Slowly drift energy particles
    const posAttr = this.particles.geometry.attributes.position;
    const arr = posAttr.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i+1] += Math.sin(t * 0.3 + i) * 0.003;
    }
    posAttr.needsUpdate = true;
  }
}

/* ================================================================
   MISSION MANAGER
   ================================================================ */
class MissionManager {
  constructor(scene) {
    this.scene = scene;
    this.missions = [
      { name: 'RING RUN',       type: 'checkpoint', scoreGoal: 5,   timeLimit: 120, description: 'Fly through all 5 energy rings!' },
      { name: 'GRAVITY GAUNTLET', type: 'checkpoint', scoreGoal: 7,  timeLimit: 150, description: 'Navigate gravity wells — collect all beacons!' },
      { name: 'FREE FLIGHT',    type: 'free',       scoreGoal: 0,   timeLimit: 0,   description: 'Explore the void. No rules.' },
    ];
    this.currentMission = 0;
    this.checkpoints    = [];
    this.score          = 0;
    this.isComplete     = false;
    this.isFreeMode     = false;
  }

  load(missionIndex) {
    this.clearCheckpoints();
    this.score      = 0;
    this.isComplete = false;
    const m = this.missions[missionIndex];
    this.isFreeMode = m.type === 'free';
    this.currentMission = missionIndex;

    if (!this.isFreeMode) {
      const count = m.scoreGoal;
      const spread = CONFIG.WORLD_BOUNDS * 0.6;
      for (let i = 0; i < count; i++) {
        const pos = new THREE.Vector3(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread));
        this._addCheckpoint(pos, i);
      }
    }
    return m;
  }

  _addCheckpoint(pos, index) {
    // Ring visual
    const geo = new THREE.TorusGeometry(CONFIG.CHECKPOINT_RADIUS, 2, 12, 60);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 1.0,
      transparent: true, opacity: 0.8,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    this.scene.add(mesh);

    const pl = new THREE.PointLight(0xffd700, 1.5, 80);
    pl.position.copy(pos);
    this.scene.add(pl);

    const cp = { position: pos, mesh, light: pl, reached: false, index };
    this.checkpoints.push(cp);
  }

  checkShipProximity(shipPos) {
    for (const cp of this.checkpoints) {
      if (!cp.reached) {
        const dist = shipPos.distanceTo(cp.position);
        if (dist < CONFIG.CHECKPOINT_RADIUS * 1.2) {
          cp.reached = true;
          cp.mesh.material.color.setHex(0x39ff14);
          cp.mesh.material.emissive.setHex(0x39ff14);
          cp.light.color.setHex(0x39ff14);
          this.score += 100;
          return cp; // return hit checkpoint for alert
        }
      }
    }
    return null;
  }

  nextUnreached() {
    return this.checkpoints.find(cp => !cp.reached) || null;
  }

  allReached() {
    return this.checkpoints.every(cp => cp.reached);
  }

  clearCheckpoints() {
    for (const cp of this.checkpoints) {
      this.scene.remove(cp.mesh);
      this.scene.remove(cp.light);
    }
    this.checkpoints = [];
  }

  updateVisuals(t) {
    for (const cp of this.checkpoints) {
      if (!cp.reached) {
        cp.mesh.rotation.x += 0.012;
        cp.mesh.rotation.y += 0.008;
      }
    }
  }
}

/* ================================================================
   SHIP MESH BUILDER — creates a futuristic spacecraft mesh
   ================================================================ */
function buildShipMesh(scene) {
  const group = new THREE.Group();

  // ---- Main body (cone hull) ----
  const bodyGeo = new THREE.ConeGeometry(2.5, 12, 8);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x112244, roughness: 0.3, metalness: 0.8,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.x = Math.PI / 2; // Point forward (-Z)
  group.add(body);

  // ---- Wings (flat boxes) ----
  const wingGeo = new THREE.BoxGeometry(14, 0.4, 5);
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x0d1a33, roughness: 0.4, metalness: 0.9,
  });
  const wings = new THREE.Mesh(wingGeo, wingMat);
  wings.position.z = 2;
  group.add(wings);

  // ---- Engine nacelles ----
  const nacellePositions = [[-5, 0, 4], [5, 0, 4]];
  const engineGlows = [];

  for (const np of nacellePositions) {
    const nGeo = new THREE.CylinderGeometry(1.2, 1.6, 4, 12);
    const nMat = new THREE.MeshStandardMaterial({ color: 0x111122, roughness: 0.2, metalness: 1 });
    const nacelle = new THREE.Mesh(nGeo, nMat);
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(...np);
    group.add(nacelle);

    // Engine glow (point light)
    const gl = new THREE.PointLight(0x00aaff, 0.5, 25);
    gl.position.set(np[0], np[1], np[2] + 3.5);
    group.add(gl);
    engineGlows.push(gl);

    // Engine emissive disk
    const diskGeo = new THREE.CircleGeometry(1.1, 16);
    const diskMat = new THREE.MeshBasicMaterial({
      color: 0x0088ff, side: THREE.DoubleSide,
    });
    const disk = new THREE.Mesh(diskGeo, diskMat);
    disk.position.set(np[0], np[1], np[2] + 2.3);
    group.add(disk);
  }

  // ---- Cockpit glass ----
  const cockpitGeo = new THREE.SphereGeometry(1.4, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const cockpitMat = new THREE.MeshStandardMaterial({
    color: 0x00f5ff, emissive: 0x003344, emissiveIntensity: 0.4,
    transparent: true, opacity: 0.6, metalness: 0.1, roughness: 0.05,
  });
  const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
  cockpit.position.z = -3;
  cockpit.rotation.x = Math.PI;
  group.add(cockpit);

  // ---- Hull accent lines (emissive) ----
  const accentGeo = new THREE.BoxGeometry(14.5, 0.15, 0.3);
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x00f5ff, emissive: 0x00f5ff, emissiveIntensity: 0.9,
  });
  const accentTop = new THREE.Mesh(accentGeo, accentMat);
  accentTop.position.set(0, 0.25, 2.5);
  group.add(accentTop);

  scene.add(group);
  return { group, engineGlows };
}

/* ================================================================
   MAIN GAME CLASS
   ================================================================ */
class NullGGame {
  constructor() {
    this.canvas      = document.getElementById('gameCanvas');
    this.renderer    = null;
    this.scene       = null;
    this.camera      = null;
    this.ship        = null;
    this.env         = null;
    this.hud         = null;
    this.minimap     = null;
    this.missions    = null;
    this.input       = new InputManager();

    this.isRunning   = false;
    this.isPaused    = false;
    this.gameMode    = 'mission'; // 'mission' | 'free'
    this.elapsedTime = 0;
    this.lastTime    = 0;

    this._bindUI();
  }

  /* ================================================================
     INITIALIZATION
     ================================================================ */
  async init() {
    this._simulateLoad();
  }

  _simulateLoad() {
    const steps = [
      'INITIALIZING PHYSICS ENGINE...',
      'BUILDING WORLD GEOMETRY...',
      'LOADING GRAVITY FIELD MATRICES...',
      'COMPILING SHADER PROGRAMS...',
      'CALIBRATING INERTIA SENSORS...',
      'SYSTEMS ONLINE — PREPARE FOR LAUNCH',
    ];
    let i = 0;
    const bar   = document.getElementById('loaderBar');
    const status= document.getElementById('loaderStatus');

    const tick = () => {
      if (i >= steps.length) {
        setTimeout(() => {
          document.getElementById('loadingScreen').classList.add('hidden');
          document.getElementById('startScreen').classList.remove('hidden');
          this._setup3D();
        }, 600);
        return;
      }
      status.textContent = steps[i];
      bar.style.width    = ((i + 1) / steps.length * 100) + '%';
      i++;
      setTimeout(tick, 400 + Math.random() * 300);
    };
    tick();
  }

  _setup3D() {
    // ---- Renderer ----
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // ---- Scene ----
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x000814, 400, 1600);

    // ---- Camera (Third-person chase cam) ----
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);
    this.cameraOffset = new THREE.Vector3(0, 4, 18); // behind + above ship
    this.cameraTarget = new THREE.Vector3();

    // ---- Lighting ----
    const ambient = new THREE.AmbientLight(0x050a20, 0.4);
    this.scene.add(ambient);

    const sunLight = new THREE.DirectionalLight(0x8899ff, 0.8);
    sunLight.position.set(500, 800, -300);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far  = 3000;
    sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -800;
    sunLight.shadow.camera.right= sunLight.shadow.camera.top    =  800;
    this.scene.add(sunLight);

    // ---- Environment ----
    this.env = new Environment(this.scene);
    this.env.build();

    // ---- Ship ----
    this.ship = new Spaceship();
    const { group, engineGlows } = buildShipMesh(this.scene);
    this.ship.mesh = group;
    this.ship.engineGlows = engineGlows;

    // ---- HUD & MiniMap ----
    this.hud     = new HUDController();
    this.minimap = new MiniMap(document.getElementById('minimap'));

    // ---- Missions ----
    this.missions = new MissionManager(this.scene);

    // ---- Resize ----
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  /* ================================================================
     UI BINDINGS
     ================================================================ */
  _bindUI() {
    document.getElementById('btnStart').addEventListener('click', () => this._startMission(0));
    document.getElementById('btnFreeFlight').addEventListener('click', () => this._startFree());
    document.getElementById('btnPause').addEventListener('click', () => this._pause());
    document.getElementById('btnResume').addEventListener('click', () => this._resume());
    document.getElementById('btnRestart').addEventListener('click', () => this._restart());
    document.getElementById('btnNextMission').addEventListener('click', () => this._nextMission());
    document.getElementById('btnMainMenu').addEventListener('click', () => this._mainMenu());

    // Keyboard shortcuts
    this.input; // already set up
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.isRunning) this.isPaused ? this._resume() : this._pause();
      }
      if (e.code === 'KeyF' && this.isRunning) this.ship.isAutopilot = !this.ship.isAutopilot;
      if (e.code === 'KeyR' && this.isRunning) this.ship.reset();
      if (e.code === 'KeyM' && this.isRunning) this._toggleMode();
    });
  }

  _startMission(index) {
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    this.gameMode  = 'mission';
    this.isRunning = true;
    this.isPaused  = false;
    this.elapsedTime = 0;
    this.ship.reset();

    const m = this.missions.load(index);
    this.hud.setMode('MISSION: ' + m.name);
    this.hud.showMissionAlert('▶ ' + m.description, 4000);
    this.hud.showCheckpointArrow(true);

    this.lastTime = performance.now();
    this._loop();
  }

  _startFree() {
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    this.gameMode  = 'free';
    this.isRunning = true;
    this.isPaused  = false;
    this.elapsedTime = 0;
    this.ship.reset();

    const m = this.missions.load(2); // free flight mission
    this.hud.setMode('FREE FLIGHT');
    this.hud.showMissionAlert('◯ Free Flight Active — No Restrictions', 3000);
    this.hud.showCheckpointArrow(false);

    this.lastTime = performance.now();
    this._loop();
  }

  _pause() {
    this.isPaused = true;
    document.getElementById('pauseScreen').classList.remove('hidden');
  }

  _resume() {
    this.isPaused = false;
    this.lastTime = performance.now();
    document.getElementById('pauseScreen').classList.add('hidden');
  }

  _restart() {
    document.getElementById('pauseScreen').classList.add('hidden');
    document.getElementById('missionComplete').classList.add('hidden');
    this._startMission(this.missions.currentMission);
  }

  _nextMission() {
    document.getElementById('missionComplete').classList.add('hidden');
    const next = (this.missions.currentMission + 1) % (this.missions.missions.length - 1);
    this._startMission(next);
  }

  _mainMenu() {
    document.getElementById('missionComplete').classList.add('hidden');
    document.getElementById('pauseScreen').classList.add('hidden');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
    this.isRunning = false;
    this.missions.clearCheckpoints();
  }

  _toggleMode() {
    if (this.gameMode === 'mission') {
      this._startFree();
    } else {
      this._startMission(this.missions.currentMission);
    }
  }

  /* ================================================================
     INPUT PROCESSING
     ================================================================ */
  _processInput() {
    const s = this.ship;
    const ip = this.input;

    // Forward / Backward
    s.thrustForward = ip.isDown('KeyW') ? 1 : ip.isDown('KeyS') ? -0.6 : 0;

    // Strafe Left / Right
    s.thrustStrafe = ip.isDown('KeyA') ? -1 : ip.isDown('KeyD') ? 1 : 0;

    // Vertical strafe: Z (up) X (down) — or CTRL/SHIFT override
    s.thrustVertical = ip.isDown('KeyZ') ? 1 : ip.isDown('KeyX') ? -1 : 0;

    // Rotation: arrows for pitch/yaw
    s.pitchInput = ip.isDown('ArrowUp') ? -1 : ip.isDown('ArrowDown') ? 1 : 0;
    s.yawInput   = ip.isDown('ArrowLeft') ? 1 : ip.isDown('ArrowRight') ? -1 : 0;
    s.rollInput  = ip.isDown('KeyQ') ? 1 : ip.isDown('KeyE') ? -1 : 0;

    // Boost
    s.isBoosting = ip.isDown('ShiftLeft') || ip.isDown('ShiftRight');

    // Stabilizer (space)
    s.isStabilizing = ip.isDown('Space');

    // Status message
    if (s.isBoosting && s.boostFuel <= 0) {
      this.hud.setStatus('⚠ BOOST DEPLETED');
    } else if (s.isStabilizing) {
      this.hud.setStatus('DAMPENERS ACTIVE');
    } else if (s.isAutopilot) {
      this.hud.setStatus('AUTOPILOT ENGAGED');
    } else {
      this.hud.setStatus('SYSTEMS NOMINAL');
    }
  }

  /* ================================================================
     CHASE CAMERA
     ================================================================ */
  _updateCamera() {
    // Offset camera behind and slightly above ship in ship-local space
    const offset = this.cameraOffset.clone().applyQuaternion(this.ship.quaternion);
    const targetPos = this.ship.position.clone().add(offset);

    // Smooth lerp towards target position
    this.camera.position.lerp(targetPos, 0.08);

    // Look at a point slightly ahead of the ship
    const lookTarget = this.ship.position.clone()
      .addScaledVector(this.ship.getForward(), 20);
    this.camera.lookAt(lookTarget);
  }

  /* ================================================================
     MISSION UPDATE
     ================================================================ */
  _updateMissions() {
    if (this.missions.isFreeMode || this.missions.isComplete) return;

    const hit = this.missions.checkShipProximity(this.ship.position);
    if (hit) {
      this.hud.showMissionAlert(`✓ CHECKPOINT ${hit.index + 1} REACHED! +100`, 2000);
    }

    if (this.missions.allReached()) {
      this.missions.isComplete = true;
      this._missionComplete();
    }

    // Arrow towards next checkpoint
    const next = this.missions.nextUnreached();
    this.hud.showCheckpointArrow(!!next);
  }

  _missionComplete() {
    this.isRunning = false;
    document.getElementById('completeTime').textContent  = fmtTime(this.elapsedTime);
    document.getElementById('completeScore').textContent = this.missions.score;
    document.getElementById('missionComplete').classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
  }

  /* ================================================================
     MAIN LOOP
     ================================================================ */
  _loop() {
    if (!this.isRunning) return;
    requestAnimationFrame(() => this._loop());

    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // Clamp dt to avoid physics explosion on tab switch
    dt = Math.min(dt, 0.05);

    if (this.isPaused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.elapsedTime += dt;
    const t = this.elapsedTime;

    // Process input
    this._processInput();

    // Update ship physics
    this.ship.update(dt, this.env.gravFields);

    // Update environment
    this.env.update(t);

    // Update missions
    this.missions.updateVisuals(t);
    this._updateMissions();

    // Update camera
    this._updateCamera();

    // Update HUD
    this.hud.update(this.ship, this.env.gravFields, t, this.missions.score);

    // Update minimap
    this.minimap.draw(this.ship.position, this.env.gravFields, this.missions.checkpoints);

    // Render scene
    this.renderer.render(this.scene, this.camera);
  }
}

/* ================================================================
   BOOT
   ================================================================ */
window.addEventListener('DOMContentLoaded', () => {
  const game = new NullGGame();
  game.init();
});