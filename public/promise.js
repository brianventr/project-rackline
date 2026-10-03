/* One line on a Shopify product page. It does not reserve stock. */
(function () {
  var node = document.getElementById("rackline-promise");
  if (!node) return;
  var shop = node.getAttribute("data-shop");
  var sku = node.getAttribute("data-sku");
  if (!shop || !sku) return;
  var origin = new URL(document.currentScript && document.currentScript.src ? document.currentScript.src : window.location.href).origin;
  var qty = node.getAttribute("data-qty") || "1";
  fetch(origin + "/api/shopify/promise?shop=" + encodeURIComponent(shop) + "&sku=" + encodeURIComponent(sku) + "&qty=" + encodeURIComponent(qty))
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (body) {
      if (body && body.line) node.textContent = body.line;
    })
    .catch(function () {});
})();
