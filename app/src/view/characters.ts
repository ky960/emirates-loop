import type { Look, RiderKit } from "./rider";
import { DEFAULT_KIT } from "./rider";

/**
 * Night-hero mode: the Shadow Falcon (an original caped hero) and the villains who ride against him.
 * All characters are original to this app.
 */
export const HERO_NAME = "Shadow Falcon";
export const HERO: RiderKit = {
  ...DEFAULT_KIT,
  look: { suit: 0x23252b, trim: 0x111114, cape: 0x14151a, capeLining: 0x8a6a10, head: "cowl", eyes: 0xffc400, bike: "hero", bikeColor: 0x1a1b20, emblem: true, light: true, armor: 0x2c2f37 },
};

export interface Villain { name: string; look: Look; taunts: string[]; beaten: string[] }

export const VILLAINS: Villain[] = [
  { name: "Sandstorm", look: { suit: 0xc9862d, trim: 0x4a2c10, cape: 0xe0a24a, capeLining: 0x7a4a18, head: "hood", eyes: 0xff9a2e, bike: "villain", bikeColor: 0x6b4a22 },
    taunts: ["Eat my dust, Falcon!", "You can't catch the wind!", "Sand in your eyes!"], beaten: ["Blown away… by a bicycle?!", "My sand… it's everywhere!", "This is the worst desert ever."] },
  { name: "The Mirage", look: { suit: 0x3a2e78, trim: 0x16123a, cape: 0x58d4e8, capeLining: 0x3a2e78, head: "tophat", eyes: 0x58d4e8, bike: "villain", bikeColor: 0x2c2560 },
    taunts: ["Now you see me…", "Am I even really here?", "Catch me? You'll catch nothing!"], beaten: ["…now you don't. Ouch.", "That was an illusion! A real one!", "Must have been the heat."] },
  { name: "Doctor Dune", look: { suit: 0x2f6b3a, trim: 0x12261a, cape: 0x6b2f6b, capeLining: 0x2f6b3a, head: "horns", eyes: 0x9cff5a, bike: "villain", bikeColor: 0x1c3a22 },
    taunts: ["Mwahaha! Too slow!", "My calculations predicted this!", "Behold my superior gears!"], beaten: ["My calculations were… off.", "Curses! Foiled by cadence!", "I should have done more science."] },
  { name: "Captain Haboob", look: { suit: 0x8a3a2a, trim: 0x2a120c, cape: 0x3a1a12, capeLining: 0xd8a24a, head: "crown", eyes: 0xff5a3a, bike: "villain", bikeColor: 0x4a1e14 },
    taunts: ["The storm is coming for you!", "Kneel before the Captain!", "Hold onto your helmet!"], beaten: ["The Captain… has been passed.", "A mere breeze, after all.", "Mutiny! On my own bike!"] },
  { name: "Scorpia", look: { suit: 0x1c1c22, trim: 0x0a0a0c, cape: 0x8a1c3a, capeLining: 0x1c1c22, head: "horns", eyes: 0xff2a6a, bike: "villain", bikeColor: 0x2a0e18 },
    taunts: ["I'll sting you at the line!", "Tick, tock, Falcon!", "You're in my desert now."], beaten: ["Ow. That stung.", "Defeated by a bird. Again.", "I'll be back… slowly."] },
  { name: "The Tar Baron", look: { suit: 0x111111, trim: 0x2b2b2b, cape: 0x2b2b2b, capeLining: 0x5a4a10, head: "tophat", eyes: 0xffdd33, bike: "villain", bikeColor: 0x0b0b0b },
    taunts: ["Stick around, why don't you?", "The road is MINE!", "Slick moves, eh?"], beaten: ["Stuck… in second place.", "My beautiful tar…", "Smooth. Too smooth."] },
];
/** The gang of three riding together. */
export const GANG = { name: "Sandstorm's gang", look: VILLAINS[0].look };

/** Sound effects for the comic bursts on screen. */
export const BURSTS = ["POW!", "ZOOM!", "WHOOSH!", "BAM!", "ZING!", "KAPOW!", "VROOM!", "WHAM!"];
