/**
 * Kùzu DDL. Node and relationship tables mirror the graph schema in docs/architecture.md.
 * `perMinute` is stored on PRODUCES/CONSUMES so production-rate queries are
 * trivially cheap (computed once at load, never at query time).
 */
export const NODE_TABLES: readonly string[] = [
  `CREATE NODE TABLE Item(
     className STRING,
     displayName STRING,
     description STRING,
     form STRING,
     stackSize INT64,
     sinkPoints INT64,
     isResource BOOLEAN,
     PRIMARY KEY(className)
   )`,
  `CREATE NODE TABLE Recipe(
     className STRING,
     displayName STRING,
     isAlternate BOOLEAN,
     durationSeconds DOUBLE,
     inBuildGun BOOLEAN,
     inWorkshop BOOLEAN,
     varPowerMin DOUBLE,
     varPowerMax DOUBLE,
     PRIMARY KEY(className)
   )`,
  `CREATE NODE TABLE Building(
     className STRING,
     displayName STRING,
     category STRING,
     powerConsumption DOUBLE,
     maxPowerConsumption DOUBLE,
     powerProduction DOUBLE,
     PRIMARY KEY(className)
   )`,
  `CREATE NODE TABLE Schematic(
     className STRING,
     displayName STRING,
     type STRING,
     tier INT64,
     PRIMARY KEY(className)
   )`,
];

export const REL_TABLES: readonly string[] = [
  'CREATE REL TABLE PRODUCES(FROM Recipe TO Item, amount DOUBLE, perMinute DOUBLE)',
  'CREATE REL TABLE CONSUMES(FROM Recipe TO Item, amount DOUBLE, perMinute DOUBLE)',
  'CREATE REL TABLE PRODUCED_IN(FROM Recipe TO Building)',
  'CREATE REL TABLE BUILD_COST(FROM Building TO Item, amount DOUBLE)',
  'CREATE REL TABLE UNLOCKS_RECIPE(FROM Schematic TO Recipe)',
  'CREATE REL TABLE UNLOCKS_BUILDING(FROM Schematic TO Building)',
  'CREATE REL TABLE UNLOCKS_ITEM(FROM Schematic TO Item)',
];
