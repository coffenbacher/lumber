function ColumnTypeGetter(databaseConnection, schema) {
  const queryInterface = databaseConnection.getQueryInterface();

  function isColumnTypeEnum(columnName) {
    const query = `
      SELECT i.udt_name
      FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_catalog.pg_enum e ON t.oid = e.enumtypid
      LEFT JOIN information_schema.columns i ON t.typname = i.udt_name
      WHERE i.column_name = '${columnName}' OR t.typname = '${columnName}'
      GROUP BY i.udt_name;
    `;

    return queryInterface.sequelize
      .query(query, { type: queryInterface.sequelize.QueryTypes.SELECT })
      .then(result => !!result.length);
  }

  function getTypeOfArrayForPostgres(table, columName) {
    const query = `
      SELECT e.udt_name as "udtName",
        (CASE WHEN e.udt_name = 'hstore'
            THEN e.udt_name ELSE e.data_type END)
          || (CASE WHEN e.character_maximum_length IS NOT NULL
            THEN '(' || e.character_maximum_length || ')' ELSE '' END) as "type",
        (SELECT array_agg(en.enumlabel) FROM pg_catalog.pg_type t
          JOIN pg_catalog.pg_enum en
          ON t.oid = en.enumtypid
          WHERE t.typname = e.udt_name) AS "special"
      FROM information_schema.columns c
      LEFT JOIN information_schema.element_types e
      ON ((c.table_catalog, c.table_schema, c.table_name, 'TABLE', c.dtd_identifier) = (e.object_catalog, e.object_schema, e.object_name, e.object_type, e.collection_type_identifier))
      WHERE table_schema = '${schema}'
        AND table_name = '${table}' AND c.column_name = '${columName}'
    `;
    return queryInterface.sequelize
      .query(query, { type: queryInterface.sequelize.QueryTypes.SELECT })
      .then(result => result[0])
      .then(info => ({
        ...info,
        special: info.special ? info.special.slice(1, -1).split(',') : [],
      }));
  }

  this.perform = async (columnInfo, columnName, tableName) => {
    const { type, special } = columnInfo;
    const mysqlEnumRegex = /ENUM\((.*)\)/i;

    switch (type) {
      case 'BIT': // NOTICE: MSSQL type.
      case 'BOOLEAN':
        return 'BOOLEAN';
      case 'CHARACTER VARYING':
      case 'TEXT':
      case 'NTEXT': // MSSQL type
      case (type.match(/TEXT.*/i) || {}).input:
      case (type.match(/VARCHAR.*/i) || {}).input:
      case (type.match(/CHAR.*/i) || {}).input:
      case 'NVARCHAR': // NOTICE: MSSQL type.
        return 'STRING';
      case 'USER-DEFINED': {
        if (queryInterface.sequelize.options.dialect === 'postgres' &&
          await isColumnTypeEnum(columnName)) {
          return `ENUM(\n        '${special.join('\',\n        \'')}',\n      )`;
        }

        return 'STRING';
      }
      case (type.match(mysqlEnumRegex) || {}).input:
        return type;
      case 'UNIQUEIDENTIFIER':
      case 'UUID':
        return 'UUID';
      case 'JSONB':
        return 'JSONB';
      case 'SMALLINT':
      case 'INTEGER':
      case 'SERIAL':
      case 'BIGSERIAL':
      case (type.match(/INT.*/i) || {}).input:
      case (type.match(/TINYINT.*/i) || {}).input:
        return 'INTEGER';
      case 'BIGINT':
        return 'BIGINT';
      case (type.match(/FLOAT.*/i) || {}).input:
        return 'FLOAT';
      case 'NUMERIC':
      case 'DECIMAL':
      case 'REAL':
      case 'DOUBLE PRECISION':
      case (type.match(/DECIMAL.*/i) || {}).input:
      case 'MONEY': // MSSQL type
        return 'DOUBLE';
      case 'DATE':
      case 'DATETIME':
      case 'TIMESTAMP':
      case 'TIMESTAMP WITH TIME ZONE':
      case 'TIMESTAMP WITHOUT TIME ZONE':
        return 'DATE';
      case 'ARRAY': {
        if (queryInterface.sequelize.options.dialect !== 'postgres') {
          return null;
        }

        const innerColumnInfo = await getTypeOfArrayForPostgres(tableName, columnName);
        return `ARRAY(DataTypes.${await this.perform(innerColumnInfo, innerColumnInfo.udtName, tableName)})`;
      }
      default:
        console.error(`Type ${type} is not handled`);
        return null;
    }
  };
}

module.exports = ColumnTypeGetter;
