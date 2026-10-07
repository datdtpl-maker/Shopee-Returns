const STATUS_COLUMN = 'Cần thay thế';
const PENDING = 'Chưa thay thế';
const DONE = 'Đã thay thế';
const STATUS_SCHEMA = {select: {options: [{name: PENDING, color: 'yellow'}, {name: DONE, color: 'green'}]}};
function nextStatus(current, sameArticle, hasLink) {
  if (!hasLink) return null;
  return sameArticle && current === DONE ? DONE : PENDING;
}
module.exports = {STATUS_COLUMN, STATUS_SCHEMA, PENDING, DONE, nextStatus};
