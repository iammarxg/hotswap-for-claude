// Separate from the credential vault. Chunks are temporary, unencrypted export data.
export async function openExportStaging() {
  const database = await new Promise((resolve,reject)=>{
    const request=indexedDB.open('hotswap-export-staging-v2',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('chunks');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('EXPORT_STORAGE_UNAVAILABLE'));
  });
  const range=(job,file)=>IDBKeyRange.bound(file === undefined ? [job] : [job,file],file === undefined ? [job,[]] : [job,file,[]]);
  const transaction=(mode,operation)=>new Promise((resolve,reject)=>{
    const tx=database.transaction('chunks',mode);
    let result;
    operation(tx.objectStore('chunks'),value=>{result=value;});
    tx.oncomplete=()=>resolve(result);
    tx.onabort=tx.onerror=()=>reject(new Error('EXPORT_STORAGE_FAILED'));
  });
  return {
    put:(job,file,index,bytes)=>transaction('readwrite',store=>store.put(new Blob([bytes]),[job,file,index])),
    blob:async(job,file,type)=>new Blob(await transaction('readonly',(store,set)=>{const request=store.getAll(range(job,file));request.onsuccess=()=>set(request.result);}),{type:type || 'application/octet-stream'}),
    clear:(job,file)=>transaction('readwrite',store=>store.delete(range(job,file))),
    prune:job=>transaction('readwrite',store=>{
      const cursor=store.openKeyCursor();
      cursor.onsuccess=()=>{const entry=cursor.result;if(!entry)return;if(entry.key[0]!==job)store.delete(entry.key);entry.continue();};
    }),
    close:()=>database.close(),
  };
}
