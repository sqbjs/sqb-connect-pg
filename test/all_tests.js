/* eslint-disable */
require('./support/env');
const assert = require('assert');
const sqb = require('sqb');
const createDatabase = require('./support/createDatabase');
const waterfall = require('putil-waterfall');

sqb.use(require('../'));

describe('sqb-connect-pg', function() {

  let pool;
  let client1;
  let schema;
  let table;
  let metaData;

  after(function() {
    if (pool)
      pool.close(true);
  });

  describe('Driver', function() {

    it('should initialize pool with pg driver', function() {
      pool = sqb.pool({
        dialect: 'pg',
        user: (process.env.DB_USER || 'postgres'),
        password: (process.env.DB_PASS || ''),
        host: (process.env.DB_HOST || 'localhost'),
        database: (process.env.DB || 'test'),
        schema: 'sqb_test',
        pool: {
          validate: true,
          max: 1
        },
        defaults: {
          naming: 'lowercase',
          objectRows: true,
          autoCommit: false
        }
      });
      assert(pool.dialect, 'pg');
    });

    it('should test pool', function() {
      return pool.test();
    });

    it('should create a connection', function() {
      return pool.acquire(connection => {
        client1 = connection._client; // Will be used later
      });
    });

    if (!process.env.SKIP_CREATE_TABLES) {
      it('create test tables', function() {
        this.slow(4000);
        return pool.acquire(connection => {
          return createDatabase(connection._client.intlcon, {
            structureScript: 'db_structure.sql',
            dataFiles: 'table-data/*.json'
          });
        });
      }).timeout(5000);
    }

    it('should fetch "airports" table (objectRows=false)', function() {
      return pool.select()
          .from('airports')
          .limit(100)
          .orderBy(['id'])
          .execute({objectRows: false}).then(result => {
            const rows = result.rows;
            assert(rows);
            assert.strictEqual(rows.length, 100);
            assert.strictEqual(rows[0][0], 'AIGRE');
          });
    });

    it('should fetch "airports" table (objectRows=true)', function() {
      return pool.select()
          .from('airports')
          .limit(100)
          .orderBy(['id'])
          .execute().then(result => {
            const rows = result.rows;
            assert(rows);
            assert.strictEqual(rows.length, 100);
            assert.strictEqual(rows[0].id, 'AIGRE');
          });
    });

    it('should fetch test table (cursor)', function() {
      this.slow(200);
      return pool.select()
          .from('airports')
          .orderBy(['id'])
          .execute({objectRows: false, cursor: true, fetchRows: 100})
          .then(result => {
            const cursor = result.cursor;
            assert(cursor);
            return cursor.next().then((row) => {
              assert.strictEqual(cursor.row, row);
              assert.strictEqual(cursor.row[0], 'AIGRE');
              return cursor.close();
            });
          });
    });

    it('should fetch test table (cursor, objectRows)', function() {
      this.slow(200);
      return pool.select()
          .from('airports')
          .orderBy(['id'])
          .execute({
            cursor: true,
            fetchRows: 100
          }).then(result => {
            const cursor = result.cursor;
            assert(cursor);
            return cursor.next().then((row) => {
              assert.strictEqual(cursor.row, row);
              assert.strictEqual(cursor.row.id, 'AIGRE');
              return cursor.close();
            });
          });
    });

    it('should use array values in `where` clouse', function() {
      return pool.select()
          .from('airports')
          .where({'id': ['AIGRE', 'LFBA']})
          .execute().then(result => {
            const rows = result.rows;
            assert(rows);
            assert.strictEqual(rows.length, 2);
            assert.strictEqual(rows[0].id, 'LFBA');
          });
    });

    it('should return error if sql is invalid', function(done) {
      pool.execute('invalid sql').then(() => {
        done(new Error('Failed'));
      }).catch(() => done());
    });

    it('should insert record with returning', function() {
      return pool.insert('airports', {
        'ID': 'X001',
        'ShortName': 'TEST',
        'Name': 'Test1'
      }).returning({ID: 'string'})
          .execute().then(result => {
            assert(result);
            assert(result.rows);
            assert.strictEqual(result.rows[0].id, 'X001');
          });
    });

    it('should update record with returning', function() {
      return pool.update('airports', {Catalog: 3345})
          .where({ID: 'LFOI'})
          .returning({Catalog: 'number'})
          .execute().then(result => {
            assert(result);
            assert(result.rows);
            assert.strictEqual(result.rows[0].catalog, 3345);
          });
    });

    it('should return updated record count', function() {
      return pool.update('airports', {temp: 1})
          .execute().then(result => {
            assert(result);
            assert.strictEqual(result.rowsAffected, 1219);
          });
    });

    it('should call startTransaction more than one', function() {
      return pool.acquire(connection => {
        return waterfall([
          () => connection.startTransaction(),
          () => connection.startTransaction()
        ]);
      });
    });

    it('should call commit more than one', function() {
      return pool.acquire(connection => {
        return waterfall([
          () => connection.startTransaction(),
          () => connection.commit(),
          () => connection.commit()
        ]);
      });
    });

    it('should call rollback more than one', function() {
      return pool.acquire(connection => {
        return waterfall([
          () => connection.startTransaction(),
          () => connection.rollback(),
          () => connection.rollback()
        ]);
      });
    });

    it('should start transaction when autoCommit is off', function() {
      return pool.acquire(conn => {
        return waterfall([
          () => conn.update('airports', {Catalog: 1234})
              .where({ID: 'LFOI'})
              .execute(),
          () => conn.rollback(),
          () => conn.select()
              .from('airports')
              .where({ID: 'LFOI'})
              .execute({objectRows: true}).then((result) => {
                assert.notStrictEqual(result.rows[0].Catalog, 1234);
              })
        ]);
      });
    });

    it('should not start transaction when autoCommit is on', function() {
      return pool.acquire({autoCommit: true}, conn => {
        return waterfall([
          () => conn.update('airports', {catalog: 1234})
              .where({ID: 'LFOI'})
              .execute(),
          () => conn.rollback(),
          () => conn.select()
              .from('airports')
              .where({ID: 'LFOI'})
              .execute({objectRows: true}).then((result) => {
                assert.strictEqual(result.rows[0].catalog, 1234);
              })
        ]);
      });
    });

  });

  describe('Meta-Data', function() {

    it('should initialize DBMeta', function() {
      metaData = new sqb.DBMeta(pool);
      metaData.invalidate();
    });

    it('should select schemas', function() {
      return metaData.select()
          .from('schemas')
          .where({schema_name: 'sqb_test'})
          .execute().then(result => {
            assert.strictEqual(result.rows.length, 1);
          });
    });

    it('should select tables', function() {
      return metaData.select()
          .from('tables')
          .where({schema_name: 'sqb_test'})
          .execute().then(result => {
            assert.strictEqual(result.rows.length, 2);
            assert.strictEqual(result.rows[0].table_name, 'airports');
          });
    });

    it('should select columns', function() {
      return metaData.select()
          .from('columns')
          .where({schema_name: 'sqb_test', table_name: 'airports'})
          .execute().then(result => {
            assert.strictEqual(result.rows.length, 14);
            assert.strictEqual(result.rows[0].column_name, 'id');
          });
    });

    it('should select primary keys', function() {
      assert.strictEqual(pool.acquired, 0);
      return metaData.select()
          .from('primary_keys')
          .where({schema_name: 'sqb_test', table_name: 'airports'})
          .execute().then(result => {
            assert.strictEqual(result.rows.length, 1);
            assert.strictEqual(result.rows[0].column_names, 'id');
          });
    });

    it('should select foreign keys', function() {
      assert.strictEqual(pool.acquired, 0);
      return metaData.select()
          .from('foreign_keys')
          .where({schema_name: 'sqb_test', table_name: 'airports'})
          .execute().then(result => {
            assert.strictEqual(result.rows.length, 1);
            assert.strictEqual(result.rows[0].column_name, 'region');
            assert.strictEqual(result.rows[0].foreign_table_name, 'regions');
            assert.strictEqual(result.rows[0].foreign_column_name, 'id');
          });
    });

    it('should get schema objects with metaData.getSchemas()', function() {
      assert.strictEqual(pool.acquired, 0);
      return metaData.getSchemas('sqb_test')
          .then(schemas => {
            assert.notEqual(schemas.length, 0);
            schema = schemas[0];
          });
    });

    it('should not get table objects with metaData.getTables()', function(done) {
      assert.strictEqual(pool.acquired, 0);
      metaData.getTables('airports')
          .then(() => done('Failed'))
          .catch(() => done());
    });

    it('should get table objects with schema.getTables()', function() {
      assert.strictEqual(pool.acquired, 0);
      return schema.getTables()
          .then(tables => {
            assert.strictEqual(tables.length, 2);
            table = tables[0];
            assert.strictEqual(table.meta.table_name, 'airports');
          });
    });

    it('should get table columns', function() {
      assert.strictEqual(pool.acquired, 0);
      return table.getColumns().then(result => {
        assert(result);
        assert(result.id);
        assert(result.id.data_type);
      });
    });

    it('should get table primary key', function() {
      return table.getPrimaryKey().then(result => {
        assert(result);
        assert.strictEqual(result.column_names, 'id');
      });
    });

    it('should get table foreign keys', function() {
      return table.getForeignKeys().then(result => {
        assert(result);
        assert(result.length);
        assert.strictEqual(result[0].column_name, 'region');
      });
    });

  });

  describe('Finalize', function() {

    it('should have no active connection after all tests', function() {
      assert.strictEqual(pool.acquired, 0);
    });

    it('should shutdown pool', function() {
      return pool.close().then(() => {
        if (!pool.isClosed)
          throw new Error('Failed');
      });
    });

    it('should closed connection ignore close()', function() {
      return client1.close();
    });

    it('should not call execute on closed connection', function(done) {
      client1.execute('', {})
          .then(() => done('Failed'))
          .catch(() => done());
    });

  });

});
