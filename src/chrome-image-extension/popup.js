const status = document.querySelector('#status'), tabs = document.querySelector('#tab'), code = document.querySelector('#code'), pair = document.querySelector('#pair'), resume = document.querySelector('#resume'), pairing = document.querySelector('#pairing');
let busy = false;
function show(message, {error = false, connected = false} = {}) {status.textContent = message; status.dataset.error = String(error); status.dataset.connected = String(connected);}
async function send(message) {const reply = await chrome.runtime.sendMessage(message); if (!reply?.ok) throw Error(reply?.message || 'Chưa kết nối được tool.'); return reply.result;}
async function initialize() {
  const [choices, state] = await Promise.all([chrome.tabs.query({url: 'https://chatgpt.com/*'}), send({kind: 'popup-status'})]);
  for (const tab of choices) {const option = document.createElement('option'); option.value = String(tab.id); option.textContent = (tab.active ? '● ' : '') + (tab.title || 'ChatGPT').slice(0, 65); tabs.append(option);}
  const chosen = choices.find(tab => tab.id === state.tabId) || choices.find(tab => tab.active) || choices[0];
  if (chosen) tabs.value = String(chosen.id);
  pair.disabled = !choices.length;
  resume.disabled = !choices.length; resume.hidden = !state.paired; pairing.open = !state.paired;
  show(choices.length ? state.message : 'Mở https://chatgpt.com trong Chrome này rồi mở lại tiện ích.', {connected: state.connected});
}
pair.addEventListener('click', async () => {
  busy = true; pair.disabled = true; resume.disabled = true; show('Đang ghép nối với tool…');
  try {const state = await send({kind: 'pair', code: code.value.trim().toUpperCase(), tabId: Number(tabs.value)}); code.value = ''; resume.hidden = false; pairing.open = false; show(state.message, {connected: state.connected});}
  catch (error) {show(error.message, {error: true});}
  finally {busy = false; pair.disabled = !tabs.options.length; resume.disabled = !tabs.options.length;}
});
resume.addEventListener('click', async () => {
  busy = true; pair.disabled = true; resume.disabled = true; show('Đang kết nối lại tab đã chọn…');
  try {const state = await send({kind: 'resume-tab', tabId: Number(tabs.value)}); show(state.message, {connected: state.connected});}
  catch (error) {show(error.message, {error: true});}
  finally {busy = false; pair.disabled = !tabs.options.length; resume.disabled = !tabs.options.length;}
});
initialize().catch(error => show(error.message, {error: true}));
setInterval(async () => {
  if (busy) return;
  try {const state = await send({kind: 'popup-status'}); show(state.message, {connected: state.connected}); resume.hidden = !state.paired;}
  catch (error) {show(error.message, {error: true});}
}, 1200);
