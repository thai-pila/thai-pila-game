import Phaser from "phaser";



export async function loadGameScene(

  game: Phaser.Game,

  gameKey: string

) {

  if (game.scene.keys[gameKey]) return;



  switch (gameKey) {

    case "find-the-match": {

      const module = await import("./find-the-match/GameScene");

      const GameSceneClass = module.default;

      game.scene.add(gameKey, GameSceneClass);

      break;

    }

    case "situation": {

      const module = await import("./situation/GameScene");

      const GameSceneClass = module.default;

      game.scene.add(gameKey, GameSceneClass);

      break;

    }

    case "flip-cards": {

      const module = await import("./flip-cards/GameScene");

      const GameSceneClass = module.default;

      game.scene.add(gameKey, GameSceneClass);

      break;

    }

    case "whack-a-mole": {

      const module = await import("./whack-a-mole/GameScene");

      const GameSceneClass = module.default;

      game.scene.add(gameKey, GameSceneClass);

      break;

    }

    case "anagram": {

      const module = await import("./anagram/GameScene");

      const GameSceneClass = module.default;

      game.scene.add(gameKey, GameSceneClass);

      break;

    }

    case "flappy-bird": {

      const module = await import("./flappy-bird/GameScene");

      const GameSceneClass = module.default;

      game.scene.add(gameKey, GameSceneClass);

      break;

    }

    case "flying-fruits": {

      const module = await import("./flying-fruits/GameScene");

      const GameSceneClass = module.default;

      game.scene.add(gameKey, GameSceneClass);

      break;

    }

    case "game-show-quiz": {

      const module = await import("./game-show-quiz/GameScene");

      const GameSceneClass = module.default;

      game.scene.add(gameKey, GameSceneClass);

      break;

    }

    case "complete-the-sentence": {

      const module = await import("./complete-the-sentence/GameScene");

      const GameSceneClass = module.default;

      game.scene.add(gameKey, GameSceneClass);

      break;

    }

    default:

      console.error(`Game not found: ${gameKey}`);

  }

}

