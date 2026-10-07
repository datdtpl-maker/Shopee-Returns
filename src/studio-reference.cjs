function readPublicReference() {
  if (location.hostname !== 'shopee.vn' || !/^\/product\/1474107882\/46268625740\/?$/.test(location.pathname)) return null;
  const visible = element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  const nodes = [...document.querySelectorAll('h1,h2,h3,div')];
  const heading = nodes.find(element => visible(element) && element.children.length === 0 && /^mô tả sản phẩm$/iu.test(element.textContent.trim()));
  if (!heading) return null;
  for (let parent = heading.parentElement, depth = 0; parent && depth < 4; parent = parent.parentElement, depth++) {
    const text = parent.innerText.trim().replace(/^mô tả sản phẩm\s*/iu, '');
    if (text.length > 100 && text.length <= 5000 && !/chi tiết sản phẩm/iu.test(text)) return {name: document.querySelector('h1')?.innerText || document.title, description: text};
  }
  return null;
}
module.exports = {readPublicReference};
