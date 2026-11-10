/**
 * Reglas de pines soldados compartidas con la tienda.
 * Carga las funciones puras marcadas en index.html.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('/* PICO_PINES_RULES_START');
const end = html.indexOf('/* PICO_PINES_RULES_END */');
assert.ok(start > 0 && end > start, 'marcadores de pines');
let src = html.slice(start, end);
src = src.replace(/\/\* PICO_PINES_RULES_START[\s\S]*?\*\//, '');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src, ctx);

const {
  extraPinesUnidad,
  productoVieneConPines,
  productoOfrecePines,
  itemPidePinesSoldados,
  extraPinesLinea,
  sumaExtraPinesPedido,
  notaPinesItem,
  totalProductosPedido,
  totalConEnvioPedido
} = ctx;

assert.strictEqual(extraPinesUnidad(), 0.25);
assert.strictEqual(productoVieneConPines({ pinesSoldados: true }), true);
assert.strictEqual(productoVieneConPines({ tienePines: true, pinesSoldados: false }), false);
assert.strictEqual(productoVieneConPines({}), false);
assert.strictEqual(productoOfrecePines({ tienePines: true }), true);
assert.strictEqual(productoOfrecePines({ tienePines: true, pinesSoldados: true }), false);
assert.strictEqual(productoOfrecePines({ pinesSoldados: false }), false);
assert.strictEqual(productoOfrecePines({}), false);

// Breadboard / Arduino: no tiene pines. Aunque llegue soldarPines, no hay etiqueta ni cobro.
{
  const item = { name: 'Arduino', price: 8, qty: 2, soldarPines: true, extraPines: 0.5 };
  assert.strictEqual(itemPidePinesSoldados(item), false);
  assert.strictEqual(extraPinesLinea(item), 0);
  assert.strictEqual(notaPinesItem(item), '');
}

// Tiene pines y ya vienen soldados.
{
  const item = { name: 'Header', price: 0.4, qty: 2, tienePines: true, pinesSoldados: true, soldarPines: true };
  assert.strictEqual(itemPidePinesSoldados(item), false);
  assert.strictEqual(extraPinesLinea(item), 0);
  assert.strictEqual(notaPinesItem(item), 'Ya viene con pines soldados');
}

// Tiene pines, no soldados, y el cliente no pidió soldar.
{
  const item = { name: 'Header', price: 0.4, qty: 3, tienePines: true, pinesSoldados: false, soldarPines: false };
  assert.strictEqual(extraPinesLinea(item), 0);
  assert.strictEqual(notaPinesItem(item), '');
}

// Cliente pide soldar un producto que sí tiene pines: $0.25 por unidad.
{
  const item = { name: 'Nano', price: 4, qty: 3, tienePines: true, pinesSoldados: false, soldarPines: true };
  assert.strictEqual(itemPidePinesSoldados(item), true);
  assert.strictEqual(extraPinesLinea(item), 0.75);
  assert.strictEqual(notaPinesItem(item), 'Soldar pines (+$0.25 c/u)');
}

// La tienda puede mandar el monto ya calculado.
assert.strictEqual(extraPinesLinea({ qty: 4, tienePines: true, soldarPines: true, extraPines: 1 }), 1);
assert.strictEqual(extraPinesLinea({ qty: 2, tienePines: true, soldarPines: true, pinesSoldados: true, extraPines: 5 }), 0);

// Pedido sin la opción: el total no cambia.
{
  const order = { total: 10, items: [{ price: 10, qty: 1, pinesSoldados: false }] };
  assert.strictEqual(sumaExtraPinesPedido(order), 0);
  assert.strictEqual(totalProductosPedido(order), 10);
  assert.strictEqual(totalConEnvioPedido(order), 10);
}

// Dos productos, solo uno pide pines. Qty 2 → $0.50. El descuento no toca el extra.
{
  const order = {
    total: 10,
    discountPct: 10,
    items: [
      { price: 6, qty: 1, tienePines: true, soldarPines: false },
      { price: 2, qty: 2, tienePines: true, soldarPines: true }
    ]
  };
  assert.strictEqual(sumaExtraPinesPedido(order), 0.5);
  assert.strictEqual(totalProductosPedido(order), 9.5);
}

// totalConDescuento ya incluye el extra: se respeta.
{
  const order = {
    total: 10,
    discountPct: 10,
    extraPines: 0.5,
    totalConDescuento: 9.5,
    items: [{ qty: 2, tienePines: true, soldarPines: true }]
  };
  assert.strictEqual(totalProductosPedido(order), 9.5);
}

// totalConDescuento se quedó en el producto descontado y olvidó el extra: se corrige.
{
  const order = {
    total: 10,
    discountPct: 10,
    totalConDescuento: 9,
    items: [{ qty: 2, tienePines: true, soldarPines: true }]
  };
  assert.strictEqual(totalProductosPedido(order), 9.5);
}

// Sin descuento y sin totalConDescuento: total + extra.
{
  const order = { total: 8, items: [{ qty: 1, tienePines: true, soldarPines: true }] };
  assert.strictEqual(totalProductosPedido(order), 8.25);
}

// totalConEnvio que olvidó el extra (productos + envío) se corrige. El que ya lo trae, no.
{
  const base = {
    total: 8,
    tipoEntrega: 'domicilio',
    envioCosto: 2,
    items: [{ qty: 1, tienePines: true, soldarPines: true }]
  };
  assert.strictEqual(totalConEnvioPedido(Object.assign({ totalConEnvio: 10 }, base)), 10.25);
  assert.strictEqual(totalConEnvioPedido(Object.assign({ totalConEnvio: 10.25 }, base)), 10.25);
}

// Sin extra, un totalConEnvio guardado no se reescribe.
assert.strictEqual(totalConEnvioPedido({ total: 8, totalConEnvio: 11, tipoEntrega: 'domicilio', envioCosto: 2 }), 11);

// Pedido de pines en un producto que ya los trae no suma, aunque haya extraPines de línea.
{
  const order = {
    total: 5,
    items: [{ qty: 4, pinesSoldados: true, soldarPines: true, extraPines: 1 }]
  };
  assert.strictEqual(sumaExtraPinesPedido(order), 0);
  assert.strictEqual(totalProductosPedido(order), 5);
  assert.strictEqual(notaPinesItem(order.items[0]), 'Ya viene con pines soldados');
}

console.log('pines-soldados-rules: ok');
