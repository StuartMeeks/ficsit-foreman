import type { Connection } from 'kuzu';

import type { GameData } from '@foreman/sf-game-data';
import { NODE_TABLES, REL_TABLES } from './schema.js';

/**
 * Loads `GameData` into Kùzu. The load is idempotent: any existing tables are
 * dropped and recreated, then every node and relationship is inserted via a
 * reusable prepared statement. The dataset is small (hundreds of items, ~300
 * production recipes) so a full rebuild is the right strategy.
 */
export async function loadGameData(conn: Connection, gameData: GameData): Promise<void> {
  await dropAll(conn);
  for (const ddl of NODE_TABLES) {
    await conn.query(ddl);
  }
  for (const ddl of REL_TABLES) {
    await conn.query(ddl);
  }

  await loadItems(conn, gameData);
  await loadRecipes(conn, gameData);
  await loadBuildings(conn, gameData);
  await loadSchematics(conn, gameData);
  await loadProductionEdges(conn, gameData);
  await loadBuildCostEdges(conn, gameData);
  await loadUnlockEdges(conn, gameData);
}

async function dropAll(conn: Connection): Promise<void> {
  // Relationship tables must be dropped before the node tables they reference.
  const tables = [
    'UNLOCKS_RECIPE',
    'UNLOCKS_BUILDING',
    'UNLOCKS_ITEM',
    'PRODUCES',
    'CONSUMES',
    'PRODUCED_IN',
    'BUILD_COST',
    'Item',
    'Recipe',
    'Building',
    'Schematic',
  ];
  for (const table of tables) {
    try {
      await conn.query(`DROP TABLE ${table}`);
    } catch {
      // Table does not exist yet on first load; ignore.
    }
  }
}

async function loadItems(conn: Connection, gameData: GameData): Promise<void> {
  const stmt = await conn.prepare(
    `CREATE (:Item {className: $className, displayName: $displayName, description: $description,
       form: $form, stackSize: $stackSize, sinkPoints: $sinkPoints, isResource: $isResource})`,
  );
  for (const item of [...Object.values(gameData.items), ...Object.values(gameData.resources)]) {
    await conn.execute(stmt, {
      className: item.className,
      displayName: item.displayName,
      description: item.description,
      form: item.form,
      stackSize: Math.trunc(item.stackSize),
      sinkPoints: Math.trunc(item.sinkPoints),
      isResource: item.isResource,
    });
  }
}

async function loadRecipes(conn: Connection, gameData: GameData): Promise<void> {
  const stmt = await conn.prepare(
    `CREATE (:Recipe {className: $className, displayName: $displayName, isAlternate: $isAlternate,
       durationSeconds: $durationSeconds, inBuildGun: $inBuildGun, inWorkshop: $inWorkshop,
       varPowerMin: $varPowerMin, varPowerMax: $varPowerMax})`,
  );
  for (const recipe of Object.values(gameData.recipes)) {
    await conn.execute(stmt, {
      className: recipe.className,
      displayName: recipe.displayName,
      isAlternate: recipe.isAlternate,
      durationSeconds: recipe.craftTime,
      inBuildGun: recipe.inBuildGun,
      inWorkshop: recipe.inWorkshop,
      varPowerMin: recipe.variablePower?.min ?? 0,
      varPowerMax: recipe.variablePower?.max ?? 0,
    });
  }
}

async function loadBuildings(conn: Connection, gameData: GameData): Promise<void> {
  const stmt = await conn.prepare(
    `CREATE (:Building {className: $className, displayName: $displayName, category: $category,
       powerConsumption: $powerConsumption, maxPowerConsumption: $maxPowerConsumption,
       powerProduction: $powerProduction})`,
  );
  for (const building of Object.values(gameData.buildings)) {
    await conn.execute(stmt, {
      className: building.className,
      displayName: building.displayName,
      category: building.category,
      powerConsumption: building.powerConsumption,
      maxPowerConsumption: building.maxPowerConsumption ?? 0,
      powerProduction: building.powerProduction ?? 0,
    });
  }
}

async function loadSchematics(conn: Connection, gameData: GameData): Promise<void> {
  const stmt = await conn.prepare(
    `CREATE (:Schematic {className: $className, displayName: $displayName, type: $type, tier: $tier})`,
  );
  for (const schematic of Object.values(gameData.schematics)) {
    await conn.execute(stmt, {
      className: schematic.className,
      displayName: schematic.displayName,
      type: schematic.type,
      tier: Math.trunc(schematic.tier),
    });
  }
}

async function loadProductionEdges(conn: Connection, gameData: GameData): Promise<void> {
  const produces = await conn.prepare(
    `MATCH (r:Recipe {className: $recipe}), (i:Item {className: $item})
     CREATE (r)-[:PRODUCES {amount: $amount, perMinute: $perMinute}]->(i)`,
  );
  const consumes = await conn.prepare(
    `MATCH (r:Recipe {className: $recipe}), (i:Item {className: $item})
     CREATE (r)-[:CONSUMES {amount: $amount, perMinute: $perMinute}]->(i)`,
  );
  const producedIn = await conn.prepare(
    `MATCH (r:Recipe {className: $recipe}), (b:Building {className: $building})
     CREATE (r)-[:PRODUCED_IN]->(b)`,
  );
  for (const recipe of Object.values(gameData.recipes)) {
    for (const product of recipe.products) {
      await conn.execute(produces, {
        recipe: recipe.className,
        item: product.itemClassName,
        amount: product.amount,
        perMinute: product.perMinute,
      });
    }
    for (const ingredient of recipe.ingredients) {
      await conn.execute(consumes, {
        recipe: recipe.className,
        item: ingredient.itemClassName,
        amount: ingredient.amount,
        perMinute: ingredient.perMinute,
      });
    }
    for (const buildingClass of recipe.producedInClasses) {
      await conn.execute(producedIn, { recipe: recipe.className, building: buildingClass });
    }
  }
}

async function loadBuildCostEdges(conn: Connection, gameData: GameData): Promise<void> {
  const stmt = await conn.prepare(
    `MATCH (b:Building {className: $building}), (i:Item {className: $item})
     CREATE (b)-[:BUILD_COST {amount: $amount}]->(i)`,
  );
  for (const building of Object.values(gameData.buildings)) {
    for (const line of building.buildCost) {
      await conn.execute(stmt, {
        building: building.className,
        item: line.itemClassName,
        amount: line.amount,
      });
    }
  }
}

async function loadUnlockEdges(conn: Connection, gameData: GameData): Promise<void> {
  const unlockRecipe = await conn.prepare(
    `MATCH (s:Schematic {className: $schematic}), (r:Recipe {className: $recipe})
     CREATE (s)-[:UNLOCKS_RECIPE]->(r)`,
  );
  const unlockBuilding = await conn.prepare(
    `MATCH (s:Schematic {className: $schematic}), (b:Building {className: $building})
     CREATE (s)-[:UNLOCKS_BUILDING]->(b)`,
  );
  const unlockItem = await conn.prepare(
    `MATCH (s:Schematic {className: $schematic}), (i:Item {className: $item})
     CREATE (s)-[:UNLOCKS_ITEM]->(i)`,
  );
  for (const schematic of Object.values(gameData.schematics)) {
    for (const recipe of schematic.unlocksRecipes) {
      await conn.execute(unlockRecipe, { schematic: schematic.className, recipe });
    }
    for (const building of schematic.unlocksBuildings) {
      await conn.execute(unlockBuilding, { schematic: schematic.className, building });
    }
    for (const item of schematic.unlocksItems) {
      await conn.execute(unlockItem, { schematic: schematic.className, item });
    }
  }
}
