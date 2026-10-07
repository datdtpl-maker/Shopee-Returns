const test=require('node:test');const assert=require('node:assert/strict');
const {studioInput}=require('../src/studio-settings.cjs');
test('Studio settings validate scalar inputs without echoing credentials',()=>{
  assert.deepEqual(studioInput({chatgptPort:'9222',geminiModel:'gemini-2.5-flash',geminiApiKey:'A'.repeat(30)}),{chatgptPort:9222,geminiModel:'gemini-2.5-flash',geminiApiKey:'A'.repeat(30)});
  assert.equal(studioInput({writingReference:'Tên\nThông tin\nCông dụng'}).writingReference,'Tên\nThông tin\nCông dụng');
  for(const input of [null,[],{unknown:'secret'}, {chatgptPort:80},{chatgptPort:9222.5},{geminiModel:'../secret'},{geminiApiKey:'sensitive-short'},{driveLocalFolder:'../outside'},{driveLocalFolder:'\\\\server\\share'}]){
    assert.throws(()=>studioInput(input),error=>!error.message.includes('sensitive-short')&&!error.message.includes('../secret'));
  }
});

test('Gemini accepts opaque dotted keys and trims clipboard edges without weakening header validation',()=>{
  const dotted = 'AQ.' + 'FAKE_EXAMPLE_'.repeat(5), legacy = 'AIza' + 'FAKE_EXAMPLE_'.repeat(3);
  for(const key of [dotted,legacy,'future.'+'A'.repeat(240)]) assert.equal(studioInput({geminiApiKey:' \r\n'+key+'\n '}).geminiApiKey,key);
  for(const value of [dotted+'\r\nx-header: injected',dotted+' x',dotted+'\0',dotted+'\u200b','A'.repeat(4097)]) assert.throws(()=>studioInput({geminiApiKey:value}),error=>!error.message.includes(value));
});
