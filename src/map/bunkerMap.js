import * as THREE from 'three';

export class BunkerMap {
  constructor(scene, eventBus) {
    this.scene = scene;
    this.eventBus = eventBus;

    // Public arrays consumed by other systems
    this.barriers = [];          // zombie window barricades
    this.wallBuyLocations = [];  // weapon purchase points
    this.doorBarriers = [];      // purchasable debris doors
    this.colliders = [];         // AABB {min,max} for collision
    this.spawnPoints = [];       // zombie spawn positions
    this.navPoints = [];         // waypoint graph
    this.mysteryBoxLocation = null;

    // Internal
    this.materials = {};
    this.lights = [];
    this.dustParticles = null;
    this.flickerTimers = [];

    this._createMaterials();
    this._build();
  }

  /* ================================================================
     MATERIALS - all procedurally generated with canvas textures
     ================================================================ */
  _createMaterials() {
    this.materials.concrete = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a, roughness: 0.92, metalness: 0.05,
      map: this._makeNoiseTex(256, '#4a4a4a', '#3a3a3a'),
    });
    this.materials.floor = new THREE.MeshStandardMaterial({
      color: 0x3d3d38, roughness: 0.95, metalness: 0.02,
      map: this._makeNoiseTex(256, '#3d3d38', '#2e2e28'),
    });
    this.materials.ceiling = new THREE.MeshStandardMaterial({
      color: 0x3a3a3a, roughness: 0.9, metalness: 0.05,
    });
    this.materials.wood = new THREE.MeshStandardMaterial({
      color: 0x6b4226, roughness: 0.85, metalness: 0.0,
      map: this._makeWoodTex(256),
    });
    this.materials.metal = new THREE.MeshStandardMaterial({
      color: 0x2a2a2a, roughness: 0.4, metalness: 0.8,
    });
    this.materials.sandbag = new THREE.MeshStandardMaterial({
      color: 0x8b7d5b, roughness: 0.95, metalness: 0.0,
    });
    this.materials.crate = new THREE.MeshStandardMaterial({
      color: 0x5a4020, roughness: 0.9, metalness: 0.0,
      map: this._makeWoodTex(128),
    });
    this.materials.debris = new THREE.MeshStandardMaterial({
      color: 0x555550, roughness: 0.95, metalness: 0.1,
    });
    this.materials.chalkWhite = new THREE.MeshStandardMaterial({
      color: 0xcccccc, roughness: 1.0, metalness: 0.0,
      transparent: true, opacity: 0.8, side: THREE.DoubleSide,
    });
    this.materials.mysteryGold = new THREE.MeshStandardMaterial({
      color: 0xffd700, roughness: 0.3, metalness: 0.7,
      emissive: 0xffa500, emissiveIntensity: 0.6,
    });
    this.materials.redLight = new THREE.MeshStandardMaterial({
      color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 1.0,
    });
  }

  _makeNoiseTex(size, baseColor, noiseColor) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 30;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    // Cracks
    ctx.strokeStyle = noiseColor;
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      let x = Math.random() * size, y = Math.random() * size;
      ctx.moveTo(x, y);
      for (let s = 0; s < 8; s++) {
        x += (Math.random() - 0.5) * 40;
        y += (Math.random() - 0.5) * 40;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
  }

  _makeWoodTex(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#6b4226';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 3) {
      ctx.strokeStyle = `rgba(${40 + Math.random() * 30},${25 + Math.random() * 20},${10},${0.3 + Math.random() * 0.3})`;
      ctx.beginPath();
      ctx.moveTo(0, y + (Math.random() - 0.5) * 2);
      for (let x = 0; x < size; x += 10) {
        ctx.lineTo(x, y + (Math.random() - 0.5) * 3);
      }
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  /* ================================================================
     BUILD - construct the entire bunker
     ================================================================ */
  _build() {
    this._buildFloors();
    this._buildStartingRoom();
    this._buildUpstairs();
    this._buildBackRoom();
    this._buildStaircase();
    this._buildBarricades();
    this._buildDoors();
    this._buildFurniture();
    this._buildWallBuys();
    this._buildMysteryBox();
    this._buildLighting();
    this._buildPipes();
    this._buildNavGraph();
    this._buildDustParticles();
  }

  /* ---- helper: create a wall segment and add collider ---- */
  _addWall(x, y, z, w, h, d, mat) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat || this.materials.concrete);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.colliders.push({
      min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
    });
    return mesh;
  }

  _addFloor(x, y, z, w, d, mat) {
    const geo = new THREE.PlaneGeometry(w, d);
    const mesh = new THREE.Mesh(geo, mat || this.materials.floor);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  /* ================================================================
     FLOORS
     ================================================================ */
  _buildFloors() {
    // Ground floor
    this._addFloor(0, 0, 0, 30, 25, this.materials.floor);
    // Upper floor (above starting room, partial)
    this._addFloor(-2, 4, -4, 15, 12, this.materials.floor);
    // Ceiling over ground floor
    this._addFloor(0, 8, 0, 30, 25, this.materials.ceiling);
  }

  /* ================================================================
     STARTING ROOM  ~20x15, centered near origin, floor y=0, ceiling y=4
     X: -10 to 10,  Z: -7.5 to 7.5
     ================================================================ */
  _buildStartingRoom() {
    const WT = 0.3; // wall thickness
    const H = 4;    // wall height
    const yC = H / 2;

    // --- Back wall (Z = -7.5) solid ---
    this._addWall(0, yC, -7.5, 20, H, WT);

    // --- Front wall (Z = 7.5) with 2 windows ---
    // left section
    this._addWall(-7.5, yC, 7.5, 5, H, WT);
    // window 1 gap: x -5 to -2  (3 wide, opening y 1-3)
    this._addWall(-3.5, 0.5, 7.5, 3, 1, WT); // below window
    this._addWall(-3.5, 3.5, 7.5, 3, 1, WT); // above window
    // between windows
    this._addWall(0, yC, 7.5, 2, H, WT);
    // window 2 gap: x 2 to 5
    this._addWall(3.5, 0.5, 7.5, 3, 1, WT);
    this._addWall(3.5, 3.5, 7.5, 3, 1, WT);
    // right section
    this._addWall(7.5, yC, 7.5, 5, H, WT);

    // --- Left wall (X = -10) with doorway to back room corridor at z=-2..0 ---
    this._addWall(-10, yC, -4.75, WT, H, 5.5);  // z -7.5 to -2
    // doorway gap z -2 to 0
    this._addWall(-10, 3.5, -1, WT, 1, 2); // lintel above door
    this._addWall(-10, yC, 3.75, WT, H, 7.5);   // z 0 to 7.5

    // --- Right wall (X = 10) solid ---
    this._addWall(10, yC, 0, WT, H, 15);

    // --- Staircase wall: partial inner wall at x=-3, z=-7.5 to -3 giving stairwell ---
    this._addWall(-3, yC, -5.25, WT, H, 4.5);
  }

  /* ================================================================
     UPSTAIRS AREA  x: -9.5 to 5,  z: -7.5 to -1,  floor y=4, ceiling y=8
     Accessible via staircase from starting room
     ================================================================ */
  _buildUpstairs() {
    const WT = 0.3;
    const H = 4;
    const yC = 4 + H / 2; // 6

    // Railing along open edge (z = -1, partial)
    const railGeo = new THREE.BoxGeometry(14, 1, 0.1);
    const rail = new THREE.Mesh(railGeo, this.materials.metal);
    rail.position.set(-2, 4.5, -1);
    this.scene.add(rail);
    this.colliders.push({
      min: new THREE.Vector3(-9, 4, -1.05),
      max: new THREE.Vector3(5, 5, -0.95),
    });

    // Back wall (shared with starting room)
    // Left wall upstairs
    this._addWall(-9.5, yC, -4.25, WT, H, 6.5);

    // Right wall upstairs  (x=5)
    this._addWall(5, yC, -4.25, WT, H, 6.5);

    // Front-upper wall (z = -1) above railing up to ceiling, with window
    this._addWall(-7, yC + 0.5, -1, 5, 3, WT);
    // window opening x -4.5 to -2, y 5-7
    this._addWall(-3.25, 5, -1, 1.5, 1, WT);
    this._addWall(-3.25, 7.5, -1, 1.5, 1, WT);
    this._addWall(1.5, yC + 0.5, -1, 7, 3, WT);

    // Spawn point for upstairs window
    this.spawnPoints.push({
      position: new THREE.Vector3(-3.25, 4, 0.5),
      barricadeIndex: 2, // will be barricade index 2
      isActive: false,    // inactive until door opened
    });
  }

  /* ================================================================
     BACK ROOM  x: -18 to -11,  z: -4 to 4,  floor y=0
     Corridor from starting room left wall doorway to back room
     ================================================================ */
  _buildBackRoom() {
    const WT = 0.3;
    const H = 4;
    const yC = H / 2;

    // Corridor: x -10 to -12, z -2 to 0
    this._addWall(-11, yC, -2, 2, H, WT);  // corridor south wall
    this._addWall(-11, yC, 0, 2, H, WT);   // corridor north wall
    this._addFloor(-11, 0, -1, 2, 2);       // corridor floor
    this._addFloor(-11, H, -1, 2, 2, this.materials.ceiling); // corridor ceiling

    // Back room walls
    // South wall (z = -4)
    this._addWall(-14.5, yC, -4, 7, H, WT);
    // North wall (z = 4) with window
    this._addWall(-13, yC, 4, 3, H, WT); // left of window
    this._addWall(-15.5, 0.5, 4, 2, 1, WT); // below window
    this._addWall(-15.5, 3.5, 4, 2, 1, WT); // above window
    this._addWall(-17, yC, 4, 1, H, WT); // right of window
    // West wall (x = -18)
    this._addWall(-18, yC, 0, WT, H, 8);
    // East wall (x = -12) with doorway from corridor
    this._addWall(-12, yC, -3, WT, H, 2); // south of doorway
    this._addWall(-12, 3.5, -1, WT, 1, 2); // lintel
    this._addWall(-12, yC, 2, WT, H, 4);  // north of doorway

    // Floor and ceiling
    this._addFloor(-15, 0, 0, 6, 8);
    this._addFloor(-15, H, 0, 6, 8, this.materials.ceiling);

    // Spawn points for back room window
    this.spawnPoints.push({
      position: new THREE.Vector3(-15.5, 0, 5.5),
      barricadeIndex: 3,
      isActive: false,
    });
  }

  /* ================================================================
     STAIRCASE  x: -9.5 to -3,  z: -7.5 to -3,  y: 0 to 4
     ================================================================ */
  _buildStaircase() {
    const steps = 12;
    const stepW = 6;
    const stepH = 4 / steps;
    const stepD = 4 / steps;

    for (let i = 0; i < steps; i++) {
      const geo = new THREE.BoxGeometry(stepW, stepH, stepD);
      const mesh = new THREE.Mesh(geo, this.materials.concrete);
      mesh.position.set(
        -6.25,
        stepH / 2 + i * stepH,
        -7.2 + i * stepD
      );
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.colliders.push({
        min: new THREE.Vector3(-9.25, i * stepH, -7.2 + i * stepD - stepD / 2),
        max: new THREE.Vector3(-3.25, (i + 1) * stepH, -7.2 + i * stepD + stepD / 2),
      });
    }

    // Handrail
    const railGeo = new THREE.CylinderGeometry(0.04, 0.04, 6, 6);
    const rail = new THREE.Mesh(railGeo, this.materials.metal);
    rail.rotation.x = Math.atan2(4, 4);
    rail.position.set(-3.2, 2.5, -5.2);
    this.scene.add(rail);
  }

  /* ================================================================
     BARRICADES (boarded-up windows)
     ================================================================ */
  _buildBarricades() {
    const windowDefs = [
      { pos: new THREE.Vector3(-3.5, 2, 7.5), rot: 0 },       // front window 1
      { pos: new THREE.Vector3(3.5, 2, 7.5), rot: 0 },        // front window 2
      { pos: new THREE.Vector3(-3.25, 6, -1), rot: 0 },        // upstairs window
      { pos: new THREE.Vector3(-15.5, 2, 4), rot: 0 },         // back room window
    ];

    // Starting room front windows are active from the start
    // Add spawn points for starting windows
    this.spawnPoints.push(
      { position: new THREE.Vector3(-3.5, 0, 9), barricadeIndex: 0, isActive: true },
      { position: new THREE.Vector3(3.5, 0, 9), barricadeIndex: 1, isActive: true },
    );

    windowDefs.forEach((def, i) => {
      const boardMeshes = [];
      const boardCount = 5;
      const group = new THREE.Group();
      group.position.copy(def.pos);

      for (let b = 0; b < boardCount; b++) {
        const bGeo = new THREE.BoxGeometry(2.5, 0.15, 0.08);
        const board = new THREE.Mesh(bGeo, this.materials.wood);
        board.position.set(
          (Math.random() - 0.5) * 0.3,
          -0.8 + b * 0.4,
          0
        );
        board.rotation.z = (Math.random() - 0.5) * 0.15;
        board.castShadow = true;
        group.add(board);
        boardMeshes.push(board);
      }

      this.scene.add(group);

      this.barriers.push({
        position: def.pos.clone(),
        boards: boardCount,
        maxBoards: boardCount,
        health: boardCount,
        isDestroyed: false,
        mesh: group,
        boardMeshes,
      });
    });
  }

  /* ================================================================
     PURCHASABLE DOORS / DEBRIS BARRIERS
     ================================================================ */
  _buildDoors() {
    // Door 1: Debris at top of staircase (unlocks upstairs) - 1000 pts
    const debris1Group = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const size = 0.3 + Math.random() * 0.6;
      const geo = new THREE.BoxGeometry(size, size, size);
      const piece = new THREE.Mesh(geo, this.materials.debris);
      piece.position.set(
        -6.25 + (Math.random() - 0.5) * 4,
        4 + Math.random() * 0.8,
        -3.2 + (Math.random() - 0.5) * 0.5
      );
      piece.rotation.set(Math.random(), Math.random(), Math.random());
      piece.castShadow = true;
      debris1Group.add(piece);
    }
    this.scene.add(debris1Group);
    // Collider blocking stair top
    const door1Collider = {
      min: new THREE.Vector3(-9.5, 4, -3.5),
      max: new THREE.Vector3(-3, 5.5, -2.8),
    };
    this.colliders.push(door1Collider);

    // Price text sprite
    const priceSprite1 = this._makePriceSprite('CLEAR DEBRIS\n1000 Points', new THREE.Vector3(-6.25, 5, -3));
    this.scene.add(priceSprite1);

    this.doorBarriers.push({
      position: new THREE.Vector3(-6.25, 4.5, -3),
      cost: 1000,
      mesh: debris1Group,
      priceSprite: priceSprite1,
      collider: door1Collider,
      isOpen: false,
      areaToUnlock: 'upstairs',
      spawnIndices: [2], // activate upstairs spawn
    });

    // Door 2: Debris blocking corridor to back room - 1250 pts
    const debris2Group = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const size = 0.3 + Math.random() * 0.5;
      const geo = new THREE.BoxGeometry(size, size, size);
      const piece = new THREE.Mesh(geo, this.materials.debris);
      piece.position.set(
        -10 + (Math.random() - 0.5) * 0.5,
        0.3 + Math.random() * 1.5,
        -1 + (Math.random() - 0.5) * 1.5
      );
      piece.rotation.set(Math.random(), Math.random(), Math.random());
      piece.castShadow = true;
      debris2Group.add(piece);
    }
    this.scene.add(debris2Group);
    const door2Collider = {
      min: new THREE.Vector3(-10.3, 0, -2.2),
      max: new THREE.Vector3(-9.7, 3, 0.2),
    };
    this.colliders.push(door2Collider);

    const priceSprite2 = this._makePriceSprite('CLEAR DEBRIS\n1250 Points', new THREE.Vector3(-10, 1.8, -1));
    this.scene.add(priceSprite2);

    this.doorBarriers.push({
      position: new THREE.Vector3(-10, 1.5, -1),
      cost: 1250,
      mesh: debris2Group,
      priceSprite: priceSprite2,
      collider: door2Collider,
      isOpen: false,
      areaToUnlock: 'backroom',
      spawnIndices: [3],
    });
  }

  _makePriceSprite(text, position) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#ffcc00';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      ctx.fillText(line, 128, 45 + i * 40);
    });
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(position);
    sprite.scale.set(2, 1, 1);
    return sprite;
  }

  /* ================================================================
     FURNITURE & ENVIRONMENTAL OBJECTS
     ================================================================ */
  _buildFurniture() {
    // Overturned table in starting room
    const tableGeo = new THREE.BoxGeometry(2, 0.1, 1);
    const table = new THREE.Mesh(tableGeo, this.materials.wood);
    table.position.set(3, 0.6, 2);
    table.rotation.z = Math.PI / 6;
    table.castShadow = true;
    this.scene.add(table);
    this.colliders.push({
      min: new THREE.Vector3(2, 0, 1.5),
      max: new THREE.Vector3(4, 1.2, 2.5),
    });

    // Military crates in starting room
    this._addCrate(6, 0.4, -4, 0.8, 0.8, 0.8);
    this._addCrate(6.9, 0.4, -4.2, 0.7, 0.7, 0.7);
    this._addCrate(6.4, 1.1, -4.1, 0.6, 0.6, 0.6);

    // Sandbag wall
    this._addSandbags(5, 0, 0);

    // Oil drums
    this._addOilDrum(-7, 0, 4);
    this._addOilDrum(-6.2, 0, 4.5);

    // Broken chair
    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.5), this.materials.wood);
    chairSeat.position.set(2, 0.45, -3);
    chairSeat.rotation.x = 0.3;
    this.scene.add(chairSeat);
    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.05), this.materials.wood);
    chairBack.position.set(2, 0.7, -3.2);
    chairBack.rotation.x = -0.4;
    this.scene.add(chairBack);

    // Filing cabinet in back room
    this._addWall(-17, 1, -2, 0.5, 2, 0.6, this.materials.metal);

    // Shelves in back room
    for (let sh = 0; sh < 3; sh++) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(2, 0.05, 0.5), this.materials.wood);
      shelf.position.set(-17, 1 + sh * 1, 1);
      this.scene.add(shelf);
    }

    // Ammo boxes in back room
    this._addCrate(-16, 0.25, 2, 0.5, 0.5, 0.3);
    this._addCrate(-15.5, 0.25, 2.3, 0.4, 0.4, 0.3);

    // Upstairs broken table
    const upTable = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.8), this.materials.wood);
    upTable.position.set(-5, 4.4, -5);
    this.scene.add(upTable);
    // Table legs
    for (const [dx, dz] of [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), this.materials.wood);
      leg.position.set(-5 + dx, 4.2, -5 + dz);
      this.scene.add(leg);
    }
  }

  _addCrate(x, y, z, w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, this.materials.crate);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.colliders.push({
      min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
    });
  }

  _addSandbags(x, y, z) {
    const group = new THREE.Group();
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const geo = new THREE.BoxGeometry(0.8, 0.3, 0.4);
        const bag = new THREE.Mesh(geo, this.materials.sandbag);
        bag.position.set(col * 0.85 - 0.85, 0.15 + row * 0.3, 0);
        bag.scale.set(1, 1, 1 + Math.random() * 0.15);
        group.add(bag);
      }
    }
    group.position.set(x, y, z);
    this.scene.add(group);
    this.colliders.push({
      min: new THREE.Vector3(x - 1.5, y, z - 0.25),
      max: new THREE.Vector3(x + 1.5, y + 0.9, z + 0.25),
    });
  }

  _addOilDrum(x, y, z) {
    const geo = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12);
    const mesh = new THREE.Mesh(geo, this.materials.metal);
    mesh.position.set(x, y + 0.45, z);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.colliders.push({
      min: new THREE.Vector3(x - 0.3, y, z - 0.3),
      max: new THREE.Vector3(x + 0.3, y + 0.9, z + 0.3),
    });
  }

  /* ================================================================
     WALL BUYS - weapon chalk outlines on walls
     ================================================================ */
  _buildWallBuys() {
    const defs = [
      // Starting room
      { weaponId: 'm1_carbine', cost: 600, pos: new THREE.Vector3(9.8, 1.8, -3), normal: new THREE.Vector3(-1, 0, 0) },
      { weaponId: 'double_barrel', cost: 1200, pos: new THREE.Vector3(9.8, 1.8, 3), normal: new THREE.Vector3(-1, 0, 0) },
      // Upstairs
      { weaponId: 'thompson', cost: 1500, pos: new THREE.Vector3(-5, 5.8, -7.3), normal: new THREE.Vector3(0, 0, 1) },
      { weaponId: 'bar', cost: 1800, pos: new THREE.Vector3(0, 5.8, -7.3), normal: new THREE.Vector3(0, 0, 1) },
      // Back room
      { weaponId: 'stg44', cost: 1200, pos: new THREE.Vector3(-17.8, 1.8, -1), normal: new THREE.Vector3(1, 0, 0) },
      { weaponId: 'trench_gun', cost: 1500, pos: new THREE.Vector3(-14, 1.8, -3.8), normal: new THREE.Vector3(0, 0, 1) },
    ];

    defs.forEach(def => {
      const group = new THREE.Group();

      // Chalk weapon outline (simplified rectangle representing weapon shape)
      const outlineCanvas = document.createElement('canvas');
      outlineCanvas.width = 256;
      outlineCanvas.height = 128;
      const ctx = outlineCanvas.getContext('2d');
      ctx.strokeStyle = '#ccccbb';
      ctx.lineWidth = 2;
      ctx.strokeRect(30, 20, 196, 60);
      // Weapon name
      ctx.fillStyle = '#ccccbb';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(def.weaponId.replace(/_/g, ' ').toUpperCase(), 128, 50);
      // Barrel line
      ctx.beginPath();
      ctx.moveTo(226, 45);
      ctx.lineTo(250, 45);
      ctx.stroke();

      const tex = new THREE.CanvasTexture(outlineCanvas);
      const planeMat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), planeMat);
      plane.position.set(0, 0.2, 0);
      group.add(plane);

      // Price sprite below
      const priceCanvas = document.createElement('canvas');
      priceCanvas.width = 256;
      priceCanvas.height = 64;
      const pctx = priceCanvas.getContext('2d');
      pctx.fillStyle = '#ffcc00';
      pctx.font = 'bold 32px Arial';
      pctx.textAlign = 'center';
      pctx.fillText(`[F] ${def.cost}`, 128, 40);
      const priceTex = new THREE.CanvasTexture(priceCanvas);
      const priceMat = new THREE.MeshBasicMaterial({ map: priceTex, transparent: true, side: THREE.DoubleSide });
      const pricePlane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), priceMat);
      pricePlane.position.set(0, -0.3, 0);
      group.add(pricePlane);

      // Orient toward player (face the normal direction)
      group.position.copy(def.pos);
      if (Math.abs(def.normal.x) > 0.5) {
        group.rotation.y = def.normal.x > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      if (def.normal.z > 0.5) {
        group.rotation.y = 0;
      } else if (def.normal.z < -0.5) {
        group.rotation.y = Math.PI;
      }

      this.scene.add(group);

      this.wallBuyLocations.push({
        position: def.pos.clone(),
        weaponId: def.weaponId,
        cost: def.cost,
        mesh: group,
        normal: def.normal.clone(),
      });
    });
  }

  /* ================================================================
     MYSTERY BOX
     ================================================================ */
  _buildMysteryBox() {
    const group = new THREE.Group();
    // Box body
    const boxGeo = new THREE.BoxGeometry(1.2, 0.6, 0.6);
    const boxMesh = new THREE.Mesh(boxGeo, this.materials.crate);
    boxMesh.position.y = 0.3;
    boxMesh.castShadow = true;
    group.add(boxMesh);

    // Lid
    const lidGeo = new THREE.BoxGeometry(1.2, 0.08, 0.6);
    const lid = new THREE.Mesh(lidGeo, this.materials.wood);
    lid.position.set(0, 0.64, 0);
    lid.name = 'mysteryBoxLid';
    group.add(lid);

    // Golden glow trim
    const trimGeo = new THREE.BoxGeometry(1.22, 0.02, 0.62);
    const trim = new THREE.Mesh(trimGeo, this.materials.mysteryGold);
    trim.position.y = 0.61;
    group.add(trim);

    // Question mark sprite
    const qCanvas = document.createElement('canvas');
    qCanvas.width = 128;
    qCanvas.height = 128;
    const qCtx = qCanvas.getContext('2d');
    qCtx.fillStyle = '#ffd700';
    qCtx.font = 'bold 80px serif';
    qCtx.textAlign = 'center';
    qCtx.fillText('?', 64, 90);
    const qTex = new THREE.CanvasTexture(qCanvas);
    const qMat = new THREE.SpriteMaterial({ map: qTex, transparent: true });
    const qSprite = new THREE.Sprite(qMat);
    qSprite.position.set(0, 1.2, 0);
    qSprite.scale.set(0.6, 0.6, 0.6);
    group.add(qSprite);

    // Point light for glow
    const boxLight = new THREE.PointLight(0xffd700, 1.5, 5);
    boxLight.position.set(0, 1, 0);
    group.add(boxLight);

    group.position.set(-15, 0, 1);
    this.scene.add(group);

    this.mysteryBoxLocation = {
      position: new THREE.Vector3(-15, 0, 1),
      mesh: group,
      lid,
    };
  }

  /* ================================================================
     LIGHTING
     ================================================================ */
  _buildLighting() {
    // Dim ambient
    const ambient = new THREE.AmbientLight(0x1a1a2e, 0.3);
    this.scene.add(ambient);

    // Starting room ceiling lights
    const lightPositions = [
      { pos: new THREE.Vector3(0, 3.8, 0), intensity: 1.2, flicker: true },
      { pos: new THREE.Vector3(-5, 3.8, 3), intensity: 0.8, flicker: true },
      { pos: new THREE.Vector3(5, 3.8, -3), intensity: 0.9, flicker: false },
    ];

    // Upstairs lights
    lightPositions.push(
      { pos: new THREE.Vector3(-4, 7.8, -4), intensity: 0.7, flicker: true },
      { pos: new THREE.Vector3(0, 7.8, -5), intensity: 0.6, flicker: false },
    );

    // Back room - red emergency light
    lightPositions.push(
      { pos: new THREE.Vector3(-15, 3.5, 0), intensity: 1.0, flicker: true, color: 0xff3300 },
    );

    lightPositions.forEach((def, i) => {
      const color = def.color || 0xffe4b0;
      const pl = new THREE.PointLight(color, def.intensity, 15);
      pl.position.copy(def.pos);
      pl.castShadow = true;
      pl.shadow.mapSize.set(512, 512);
      pl.shadow.radius = 4;
      this.scene.add(pl);

      // Light fixture mesh
      const fixtureGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.1, 8);
      const fixtureMat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.8,
      });
      const fixture = new THREE.Mesh(fixtureGeo, fixtureMat);
      fixture.position.copy(def.pos);
      this.scene.add(fixture);

      // Hanging wire
      const wireGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.3, 4);
      const wire = new THREE.Mesh(wireGeo, this.materials.metal);
      wire.position.set(def.pos.x, def.pos.y + 0.2, def.pos.z);
      this.scene.add(wire);

      this.lights.push({
        light: pl,
        baseIntensity: def.intensity,
        flicker: def.flicker,
        flickerTimer: Math.random() * 10,
      });
    });
  }

  /* ================================================================
     CEILING PIPES
     ================================================================ */
  _buildPipes() {
    const pipeDefs = [
      { start: new THREE.Vector3(-9, 3.6, -7), end: new THREE.Vector3(-9, 3.6, 7) },
      { start: new THREE.Vector3(-9, 3.6, 0), end: new THREE.Vector3(9, 3.6, 0) },
      { start: new THREE.Vector3(8, 3.6, -7), end: new THREE.Vector3(8, 3.6, 7) },
      { start: new THREE.Vector3(-9, 3.6, -5), end: new THREE.Vector3(5, 3.6, -5) },
    ];

    pipeDefs.forEach(def => {
      const dir = new THREE.Vector3().subVectors(def.end, def.start);
      const length = dir.length();
      const geo = new THREE.CylinderGeometry(0.06, 0.06, length, 8);
      const pipe = new THREE.Mesh(geo, this.materials.metal);
      const mid = new THREE.Vector3().addVectors(def.start, def.end).multiplyScalar(0.5);
      pipe.position.copy(mid);
      // Orient cylinder along direction
      const axis = new THREE.Vector3(0, 1, 0);
      const dirNorm = dir.clone().normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(axis, dirNorm);
      pipe.quaternion.copy(quat);
      pipe.castShadow = true;
      this.scene.add(pipe);

      // Pipe brackets every 3 units
      const bracketCount = Math.floor(length / 3);
      for (let b = 0; b <= bracketCount; b++) {
        const t = b / Math.max(bracketCount, 1);
        const bPos = new THREE.Vector3().lerpVectors(def.start, def.end, t);
        const bracket = new THREE.Mesh(
          new THREE.BoxGeometry(0.15, 0.15, 0.15),
          this.materials.metal
        );
        bracket.position.copy(bPos);
        this.scene.add(bracket);
      }
    });

    // Dripping pipe (visual only, broken pipe segment hanging down)
    const brokenPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8),
      this.materials.metal
    );
    brokenPipe.position.set(4, 3.3, 2);
    brokenPipe.rotation.x = 0.3;
    this.scene.add(brokenPipe);
  }

  /* ================================================================
     NAVIGATION GRAPH (simple waypoints for zombie pathfinding)
     ================================================================ */
  _buildNavGraph() {
    // Starting room waypoints
    const pts = [
      new THREE.Vector3(0, 0.5, 0),      // 0  center
      new THREE.Vector3(-5, 0.5, 0),     // 1  left
      new THREE.Vector3(5, 0.5, 0),      // 2  right
      new THREE.Vector3(0, 0.5, 5),      // 3  front
      new THREE.Vector3(0, 0.5, -5),     // 4  back
      new THREE.Vector3(-5, 0.5, 5),     // 5  front-left
      new THREE.Vector3(5, 0.5, 5),      // 6  front-right
      new THREE.Vector3(-5, 0.5, -5),    // 7  back-left
      new THREE.Vector3(5, 0.5, -5),     // 8  back-right
      new THREE.Vector3(-3.5, 0.5, 7),   // 9  window 1
      new THREE.Vector3(3.5, 0.5, 7),    // 10 window 2
      // Staircase
      new THREE.Vector3(-6.25, 2, -5),   // 11 mid-stair
      new THREE.Vector3(-6.25, 4.2, -3), // 12 top of stair
      // Upstairs
      new THREE.Vector3(-4, 4.5, -4),    // 13 upstairs left
      new THREE.Vector3(0, 4.5, -4),     // 14 upstairs center
      new THREE.Vector3(3, 4.5, -4),     // 15 upstairs right
      new THREE.Vector3(-3.25, 4.5, -1.5), // 16 upstairs window area
      // Corridor to back room
      new THREE.Vector3(-10.5, 0.5, -1), // 17 corridor
      new THREE.Vector3(-12, 0.5, -1),   // 18 corridor end
      // Back room
      new THREE.Vector3(-15, 0.5, 0),    // 19 back room center
      new THREE.Vector3(-15, 0.5, -2),   // 20 back room south
      new THREE.Vector3(-15, 0.5, 2),    // 21 back room north
      new THREE.Vector3(-15.5, 0.5, 3.5),// 22 back room window
    ];

    // Adjacency
    const connections = [
      [1, 2, 3, 4],          // 0
      [0, 5, 7, 17],         // 1
      [0, 6, 8],             // 2
      [0, 5, 6, 9, 10],      // 3
      [0, 7, 8, 11],         // 4
      [1, 3, 9],             // 5
      [2, 3, 10],            // 6
      [1, 4, 11],            // 7
      [2, 4],                // 8
      [3, 5],                // 9
      [3, 6],                // 10
      [4, 7, 12],            // 11
      [11, 13],              // 12
      [12, 14, 16],          // 13
      [13, 15],              // 14
      [14],                  // 15
      [13],                  // 16
      [1, 18],               // 17
      [17, 19],              // 18
      [18, 20, 21],          // 19
      [19],                  // 20
      [19, 22],              // 21
      [21],                  // 22
    ];

    pts.forEach((p, i) => {
      this.navPoints.push({
        position: p,
        connections: connections[i] || [],
      });
    });
  }

  /* ================================================================
     AMBIENT DUST PARTICLES
     ================================================================ */
  _buildDustParticles() {
    const count = 200;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 1] = Math.random() * 4;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x888888,
      size: 0.03,
      transparent: true,
      opacity: 0.4,
    });
    this.dustParticles = new THREE.Points(geo, mat);
    this.scene.add(this.dustParticles);
  }

  /* ================================================================
     PUBLIC API
     ================================================================ */

  /** Check sphere vs AABB collision */
  checkCollision(position, radius) {
    let collided = false;
    const corrected = position.clone();
    const r = radius || 0.4;

    for (const box of this.colliders) {
      const cx = Math.max(box.min.x, Math.min(corrected.x, box.max.x));
      const cy = Math.max(box.min.y, Math.min(corrected.y, box.max.y));
      const cz = Math.max(box.min.z, Math.min(corrected.z, box.max.z));

      const dx = corrected.x - cx;
      const dy = corrected.y - cy;
      const dz = corrected.z - cz;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < r * r) {
        collided = true;
        const dist = Math.sqrt(distSq) || 0.001;
        const overlap = r - dist;
        corrected.x += (dx / dist) * overlap;
        corrected.z += (dz / dist) * overlap;
      }
    }
    return { collided, correctedPosition: corrected };
  }

  /** Raycast against colliders */
  raycast(origin, direction, maxDist) {
    const ray = new THREE.Raycaster(origin, direction.clone().normalize(), 0, maxDist || 100);
    // Collect all meshes in scene that are regular geometry (not sprites/points)
    const meshes = [];
    this.scene.traverse(child => {
      if (child.isMesh && child.geometry) meshes.push(child);
    });
    const hits = ray.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const h = hits[0];
      return {
        hit: true,
        point: h.point,
        normal: h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0),
        distance: h.distance,
      };
    }
    return { hit: false, point: null, normal: null, distance: maxDist };
  }

  /** Open a purchasable door */
  openDoor(doorIndex) {
    const door = this.doorBarriers[doorIndex];
    if (!door || door.isOpen) return false;
    door.isOpen = true;

    // Remove debris mesh
    this.scene.remove(door.mesh);
    this.scene.remove(door.priceSprite);

    // Remove collider
    const ci = this.colliders.indexOf(door.collider);
    if (ci >= 0) this.colliders.splice(ci, 1);

    // Activate spawn points in the new area
    door.spawnIndices.forEach(si => {
      if (this.spawnPoints[si]) this.spawnPoints[si].isActive = true;
    });

    if (this.eventBus) this.eventBus.emit('doorOpened', { area: door.areaToUnlock });
    return true;
  }

  /** Get barricade data */
  getBarricade(index) {
    return this.barriers[index] || null;
  }

  /** Rebuild a barricade (add a board back) */
  rebuildBarricade(index) {
    const b = this.barriers[index];
    if (!b || b.boards >= b.maxBoards) return false;
    b.boards++;
    b.isDestroyed = false;
    if (b.boardMeshes[b.boards - 1]) {
      b.boardMeshes[b.boards - 1].visible = true;
    }
    return true;
  }

  /** Damage a barricade (zombie tears a board) */
  damageBarricade(index) {
    const b = this.barriers[index];
    if (!b || b.boards <= 0) return false;
    b.boards--;
    if (b.boardMeshes[b.boards]) {
      b.boardMeshes[b.boards].visible = false;
    }
    if (b.boards <= 0) b.isDestroyed = true;
    return true;
  }

  /** Get currently active spawn points */
  getSpawnPoints() {
    return this.spawnPoints.filter(sp => sp.isActive);
  }

  /** Simple A* pathfinding on nav graph */
  getNavPath(from, to) {
    // Find nearest navPoints to from/to
    let startIdx = 0, endIdx = 0;
    let startDist = Infinity, endDist = Infinity;
    for (let i = 0; i < this.navPoints.length; i++) {
      const d1 = from.distanceTo(this.navPoints[i].position);
      const d2 = to.distanceTo(this.navPoints[i].position);
      if (d1 < startDist) { startDist = d1; startIdx = i; }
      if (d2 < endDist) { endDist = d2; endIdx = i; }
    }

    if (startIdx === endIdx) return [to];

    // A*
    const open = [startIdx];
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();
    gScore.set(startIdx, 0);
    fScore.set(startIdx, from.distanceTo(to));

    while (open.length > 0) {
      // Get node with lowest fScore
      open.sort((a, b) => (fScore.get(a) || Infinity) - (fScore.get(b) || Infinity));
      const current = open.shift();

      if (current === endIdx) {
        // Reconstruct path
        const path = [to];
        let c = current;
        while (cameFrom.has(c)) {
          c = cameFrom.get(c);
          if (c !== startIdx) path.unshift(this.navPoints[c].position);
        }
        return path;
      }

      const neighbors = this.navPoints[current].connections;
      for (const n of neighbors) {
        const tentG = (gScore.get(current) || 0) +
          this.navPoints[current].position.distanceTo(this.navPoints[n].position);
        if (tentG < (gScore.get(n) || Infinity)) {
          cameFrom.set(n, current);
          gScore.set(n, tentG);
          fScore.set(n, tentG + this.navPoints[n].position.distanceTo(to));
          if (!open.includes(n)) open.push(n);
        }
      }
    }

    // No path found, just go direct
    return [to];
  }

  /** Frame update - flickering lights, dust */
  update(deltaTime) {
    // Flicker lights
    for (const lData of this.lights) {
      if (lData.flicker) {
        lData.flickerTimer += deltaTime;
        const flicker = Math.sin(lData.flickerTimer * 15) * 0.15 +
                         Math.sin(lData.flickerTimer * 37) * 0.08 +
                         (Math.random() - 0.5) * 0.05;
        lData.light.intensity = Math.max(0.1, lData.baseIntensity + flicker);
      }
    }

    // Drift dust particles
    if (this.dustParticles) {
      const posArr = this.dustParticles.geometry.attributes.position.array;
      for (let i = 0; i < posArr.length; i += 3) {
        posArr[i] += (Math.random() - 0.5) * 0.002;
        posArr[i + 1] += (Math.random() - 0.5) * 0.001;
        posArr[i + 2] += (Math.random() - 0.5) * 0.002;
        // Wrap around if out of bounds
        if (posArr[i + 1] > 4) posArr[i + 1] = 0;
        if (posArr[i + 1] < 0) posArr[i + 1] = 4;
      }
      this.dustParticles.geometry.attributes.position.needsUpdate = true;
    }
  }
}
