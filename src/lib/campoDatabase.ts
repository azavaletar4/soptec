import type { UseStore } from 'idb-keyval';

const DATABASE = 'smartrayco-campo';
const STORES = ['drafts', 'closures'];
let connection: Promise<IDBDatabase> | undefined;

function open(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, version);
    let abandoned = false;
    request.onupgradeneeded = () => {
      if (abandoned) { request.transaction?.abort(); return; }
      for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onblocked = () => {
      abandoned = true;
      reject(new Error('Otra vista de Campo mantiene abierto el almacenamiento. Guarda tu trabajo y cierra las otras vistas antes de reintentar. No borres los datos de la aplicación.'));
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (abandoned) { request.result.close(); return; }
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = undefined; };
      db.onclose = () => { connection = undefined; };
      resolve(db);
    };
  });
}

async function ensureDatabase(): Promise<IDBDatabase> {
  // Dos pestañas pueden descubrir simultáneamente un esquema anterior.
  for (let attempt = 0; attempt < 3; attempt++) {
    const db = await open();
    if (STORES.every(name => db.objectStoreNames.contains(name))) return db;
    const next = db.version + 1;
    db.close();
    try { return await open(next); }
    catch (error) {
      if ((error as DOMException)?.name !== 'VersionError') throw error;
    }
  }
  throw new Error('No se pudo actualizar el almacenamiento de Campo. Los trabajos guardados se conservan.');
}

function database(): Promise<IDBDatabase> {
  if (!connection) connection = ensureDatabase().catch(error => { connection = undefined; throw error; });
  return connection;
}

/** Upgrade aditivo y compartido: jamás borra registros, stores ni Blobs. */
export function campoStore(name: 'drafts' | 'closures'): UseStore {
  return async (mode, callback) => {
    let db = await database();
    let transaction: IDBTransaction;
    try { transaction = db.transaction(name, mode); }
    catch (error) {
      // Solo se repite la creación de transacción, nunca una escritura enviada.
      if ((error as DOMException)?.name !== 'InvalidStateError') throw error;
      connection = undefined; db = await database(); transaction = db.transaction(name, mode);
    }
    return callback(transaction.objectStore(name));
  };
}

export async function closeCampoDatabase() {
  const pending = connection;
  connection = undefined;
  if (pending) (await pending).close();
}
