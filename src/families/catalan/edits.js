// Edit intents for the Catalan family.
//
// An affordance never returns a raw path — it returns one of these descriptors
// naming WHAT changed (in the shared model vocabulary: pair ids and path
// positions). The shell turns it into the next path via applyEdit and then
// hands the same descriptor to every view, so a representation that understands
// the action can animate that specific transition instead of rebuilding blindly.
//
//   { type: "insert", kind: "peak" | "valley", at }  -- grow by one pair
//   { type: "remove", kind: "peak" | "valley", at }  -- shrink by one pair
//   { type: "swap",   at }                            -- elementary (peak<->valley) move
//   { type: "rotate", pair }                          -- size-preserving tree rotation
//   { type: "set",    path }                          -- escape hatch: a reshape with
//                                                        no shared semantics; just snap
//
// insert/remove are exact inverses: insertPeak/removePeak add or excise a `UD`
// pair, insertValley/removeValley a `DU` pair. applyEdit returns the next path,
// or null if the edit is not valid here (the shell drops nulls). It is the
// single place edits become paths.

import {
  analyze,
  insertPeak,
  insertValley,
  removePeak,
  removeValley,
  elementaryMove,
} from "./model.js";
import { pathToTree, treeToPath, rotateAtPair } from "./tree.js";

export function applyEdit(path, edit) {
  switch (edit.type) {
    case "insert":
      return edit.kind === "valley" ? insertValley(path, edit.at) : insertPeak(path, edit.at);
    case "remove":
      return edit.kind === "valley" ? removeValley(path, edit.at) : removePeak(path, edit.at);
    case "swap":
      return elementaryMove(path, edit.at);
    case "rotate": {
      const { pairOfStep } = analyze(path);
      return treeToPath(rotateAtPair(pathToTree(path, pairOfStep), edit.pair));
    }
    case "set":
      return edit.path;
    default:
      return null;
  }
}
