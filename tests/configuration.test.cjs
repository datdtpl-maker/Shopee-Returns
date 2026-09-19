const {test}=require('node:test');const assert=require('node:assert/strict');const {connectionInput,notionIds}=require('../src/configuration.cjs');
test('connection import accepts only supported scalar settings and never includes secret values in errors',()=>{
 const value={notionToken:'test-value',autoScan:true,intervalMinutes:10};assert.deepEqual(connectionInput(value),value);
 for(const bad of [null,[],{autoScan:'false'},{notionToken:{}},{password:'do-not-display'},{__proto__:null,unexpected:'do-not-display'}]){assert.throws(()=>connectionInput(bad),e=>!e.message.includes('do-not-display'));}
});
test('Notion target validation keeps current target unless explicitly changed',()=>{
 const current={notionPageId:'3d970655a9aa801ca5adfe0e07f32c4a',notionDatabaseId:''};assert.deepEqual(notionIds({},current),current);
 assert.throws(()=>notionIds({notionPageId:'https://untrusted.test'},current));assert.throws(()=>notionIds({notionDatabaseId:'invalid'},current));
});
