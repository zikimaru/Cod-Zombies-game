/**
 * weaponData.js - Weapon statistics database for all weapons in the game.
 * Contains damage values, fire rates, ammo counts, costs, and model positioning
 * for every weapon available through wall buys or the mystery box.
 */

export const WEAPONS_DATA = {
  colt_m1911: {
    name: 'Colt M1911',
    type: 'pistol',
    damage: 30,
    headshotMultiplier: 2.5,
    fireRate: 0.2,
    reloadTime: 1.5,
    magazineSize: 8,
    reserveAmmo: 80,
    spread: 0.02,
    recoil: 0.03,
    range: 50,
    isAutomatic: false,
    wallBuyCost: 0,
    ammoCost: 0,
    modelScale: 0.15,
    modelOffset: { x: 0.3, y: -0.25, z: -0.5 }
  },

  m1_carbine: {
    name: 'M1 Carbine',
    type: 'rifle',
    damage: 40,
    headshotMultiplier: 2.5,
    fireRate: 0.15,
    reloadTime: 2.0,
    magazineSize: 15,
    reserveAmmo: 120,
    spread: 0.01,
    recoil: 0.025,
    range: 100,
    isAutomatic: false,
    wallBuyCost: 600,
    ammoCost: 300,
    modelScale: 0.15,
    modelOffset: { x: 0.32, y: -0.28, z: -0.55 }
  },

  thompson: {
    name: 'Thompson',
    type: 'smg',
    damage: 25,
    headshotMultiplier: 2.0,
    fireRate: 0.075,
    reloadTime: 2.5,
    magazineSize: 30,
    reserveAmmo: 180,
    spread: 0.04,
    recoil: 0.02,
    range: 40,
    isAutomatic: true,
    wallBuyCost: 1500,
    ammoCost: 750,
    modelScale: 0.15,
    modelOffset: { x: 0.3, y: -0.26, z: -0.5 }
  },

  double_barrel: {
    name: 'Double-Barrel Shotgun',
    type: 'shotgun',
    damage: 120,
    headshotMultiplier: 1.5,
    fireRate: 0.4,
    reloadTime: 3.0,
    magazineSize: 2,
    reserveAmmo: 60,
    spread: 0.12,
    recoil: 0.06,
    range: 15,
    isAutomatic: false,
    pellets: 8,
    wallBuyCost: 1200,
    ammoCost: 600,
    modelScale: 0.15,
    modelOffset: { x: 0.3, y: -0.25, z: -0.55 }
  },

  bar: {
    name: 'BAR',
    type: 'lmg',
    damage: 45,
    headshotMultiplier: 2.0,
    fireRate: 0.1,
    reloadTime: 3.0,
    magazineSize: 20,
    reserveAmmo: 200,
    spread: 0.03,
    recoil: 0.035,
    range: 80,
    isAutomatic: true,
    wallBuyCost: 1800,
    ammoCost: 900,
    modelScale: 0.15,
    modelOffset: { x: 0.32, y: -0.27, z: -0.55 }
  },

  stg44: {
    name: 'STG-44',
    type: 'rifle',
    damage: 40,
    headshotMultiplier: 2.0,
    fireRate: 0.09,
    reloadTime: 2.5,
    magazineSize: 30,
    reserveAmmo: 180,
    spread: 0.025,
    recoil: 0.03,
    range: 70,
    isAutomatic: true,
    wallBuyCost: 1200,
    ammoCost: 600,
    modelScale: 0.15,
    modelOffset: { x: 0.3, y: -0.26, z: -0.52 }
  },

  trench_gun: {
    name: 'Trench Gun',
    type: 'shotgun',
    damage: 100,
    headshotMultiplier: 1.5,
    fireRate: 0.8,
    reloadTime: 4.0,
    magazineSize: 6,
    reserveAmmo: 60,
    spread: 0.1,
    recoil: 0.05,
    range: 20,
    isAutomatic: false,
    pellets: 8,
    wallBuyCost: 1500,
    ammoCost: 750,
    modelScale: 0.15,
    modelOffset: { x: 0.3, y: -0.26, z: -0.55 }
  },

  ray_gun: {
    name: 'Ray Gun',
    type: 'special',
    damage: 1000,
    headshotMultiplier: 1.5,
    fireRate: 0.3,
    reloadTime: 3.0,
    magazineSize: 20,
    reserveAmmo: 160,
    spread: 0.01,
    recoil: 0.02,
    range: 100,
    isAutomatic: false,
    isExplosive: true,
    explosionRadius: 3,
    wallBuyCost: 0,
    ammoCost: 0,
    modelScale: 0.15,
    modelOffset: { x: 0.3, y: -0.24, z: -0.48 }
  }
};
