/**
 * Reglas de factura/correo compartidas con la tienda.
 * Carga las funciones puras marcadas en index.html y cubre los casos:
 * efectivo, tarjeta sin pagar, tarjeta pagada (stats una vez),
 * cancelar con/sin factura y créditos 100%.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('/* PICO_FACTURA_RULES_START');
const end = html.indexOf('/* PICO_FACTURA_RULES_END */');
assert.ok(start > 0 && end > start, 'marcadores de reglas');
let src = html.slice(start, end);
src = src.replace(/\/\* PICO_FACTURA_RULES_START[\s\S]*?\*\//, '');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src, ctx);

const {
  pedidoEsperaPagoTarjeta,
  etiquetaFacturaPedido,
  planAccionFacturaPedido,
  entregaCuentaProductos,
  facturasParaAnular
} = ctx;

function assertMail(plan, equipo, cliente) {
  assert.strictEqual(plan.mailEquipo, equipo, 'mail equipo');
  assert.strictEqual(plan.mailCliente, cliente, 'mail cliente');
}

// Efectivo → factura + correo al crear
{
  const o = { metodoPago: 'efectivo', paymentStatus: 'efectivo', email: 'ana@correo.com', total: 10 };
  assert.strictEqual(pedidoEsperaPagoTarjeta(o), false);
  const plan = planAccionFacturaPedido(o);
  assert.strictEqual(plan.crear, true);
  assert.strictEqual(plan.actualizar, false);
  assertMail(plan, true, true);
  assert.strictEqual(etiquetaFacturaPedido(o).kind, 'none');
}

// Efectivo que ya tiene factura: no otra, y no repetir correos
{
  const o = {
    metodoPago: 'efectivo',
    facturaId: 'fac1',
    facturaNum: 'FAC-00012',
    mailNotifySent: true,
    facturaClienteMailSent: true,
    email: 'ana@correo.com'
  };
  const plan = planAccionFacturaPedido(o);
  assert.strictEqual(plan.crear, false);
  assert.strictEqual(plan.actualizar, true);
  assertMail(plan, false, false);
  const et = etiquetaFacturaPedido(o);
  assert.strictEqual(et.kind, 'num');
  assert.strictEqual(et.text, 'FAC-00012');
}

// Tarjeta sin pagar → sin factura ni correo. UI informativa, no error.
{
  const o = { metodoPago: 'tarjeta', paymentStatus: 'pending', email: 'ana@correo.com', totalConEnvio: 12.5 };
  assert.strictEqual(pedidoEsperaPagoTarjeta(o), true);
  const plan = planAccionFacturaPedido(o);
  assert.strictEqual(plan.crear, false);
  assert.strictEqual(plan.actualizar, false);
  assertMail(plan, false, false);
  assert.strictEqual(plan.ui, 'Factura al confirmar pago');
  const et = etiquetaFacturaPedido(o);
  assert.strictEqual(et.kind, 'wait');
  assert.strictEqual(et.text, 'Factura al confirmar pago');
  assert.ok(!/error/i.test(et.text));
}

// Tarjeta pagada sin factura todavía → crear + correos. Stats ya no se vuelven a sumar.
{
  const o = {
    metodoPago: 'tarjeta',
    paymentStatus: 'paid',
    statsRecorded: true,
    email: 'ana@correo.com',
    totalConEnvio: 20
  };
  assert.strictEqual(pedidoEsperaPagoTarjeta(o), false);
  const plan = planAccionFacturaPedido(o);
  assert.strictEqual(plan.crear, true);
  assertMail(plan, true, true);
  assert.strictEqual(entregaCuentaProductos(o), false);
}

// Tarjeta pagada con factura y flags: no duplicar FAC ni correos; stats una sola vez
{
  const o = {
    metodoPago: 'tarjeta',
    paymentStatus: 'paid',
    statsRecorded: true,
    facturaId: 'fac9',
    facturaNum: 'FAC-00009',
    mailNotifySent: true,
    facturaClienteMailSent: true,
    email: 'ana@correo.com'
  };
  const plan = planAccionFacturaPedido(o);
  assert.strictEqual(plan.crear, false);
  assertMail(plan, false, false);
  assert.strictEqual(entregaCuentaProductos(o), false);
}

// Efectivo todavía no entregado: al entregar SÍ cuenta productos (una vez)
{
  assert.strictEqual(entregaCuentaProductos({ metodoPago: 'efectivo', statsRecorded: false }), true);
  assert.strictEqual(entregaCuentaProductos({ metodoPago: 'efectivo' }), true);
}

// 100% créditos → factura + correos al crear (como pagado)
{
  const porEstado = { metodoPago: 'tarjeta', paymentStatus: 'credits', creditsFullyPaid: true, email: 'ana@correo.com', totalConEnvio: 0 };
  const porFlag = { metodoPago: 'tarjeta', paymentStatus: 'pending', creditsFullyPaid: true, email: 'ana@correo.com', totalConEnvio: 8 };
  const porCero = { metodoPago: 'tarjeta', paymentStatus: 'pending', totalConEnvio: 0, email: 'ana@correo.com' };
  for (const o of [porEstado, porFlag, porCero]) {
    assert.strictEqual(pedidoEsperaPagoTarjeta(o), false, JSON.stringify(o));
    const plan = planAccionFacturaPedido(o);
    assert.strictEqual(plan.crear, true);
    assertMail(plan, true, true);
  }
}

// Créditos con correo ya enviado: se puede crear la factura faltante, sin repetir avisos
{
  const o = {
    metodoPago: 'tarjeta',
    paymentStatus: 'credits',
    creditsFullyPaid: true,
    mailNotifySent: true,
    facturaClienteMailSent: true,
    email: 'ana@correo.com'
  };
  const plan = planAccionFacturaPedido(o);
  assert.strictEqual(plan.crear, true);
  assertMail(plan, false, false);
}

// Cancelar efectivo con factura → anular ese id, no inventar otro
{
  const ids = facturasParaAnular(
    { metodoPago: 'efectivo', facturaId: 'fac1', facturaNum: 'FAC-00001' },
    [{ id: 'fac1' }]
  );
  assert.strictEqual(ids.length, 1);
  assert.strictEqual(ids[0], 'fac1');
}

// Cancelar tarjeta sin pagar → sin factura
{
  const ids = facturasParaAnular(
    { metodoPago: 'tarjeta', paymentStatus: 'pending', stockDeducted: true },
    []
  );
  assert.strictEqual(ids.length, 0);
  assert.strictEqual(planAccionFacturaPedido({ metodoPago: 'tarjeta', paymentStatus: 'pending' }).crear, false);
}

// Un facturaId huérfano (doc que no existe) no se inventa
{
  const ids = facturasParaAnular({ facturaId: 'no-existe' }, []);
  assert.strictEqual(ids.length, 0);
}

// El HTML de la fila no trata la espera como error
{
  const marker = 'pedido-factura-wait"><i class="ti ti-clock"></i> Factura al confirmar pago';
  const at = html.indexOf(marker);
  assert.ok(at > 0, 'falta el aviso en la fila de pedidos');
  const snippet = html.slice(at, at + marker.length + 30);
  assert.ok(!snippet.includes('ti-alert-circle'));
  assert.ok(!snippet.includes('var(--r600)'));
  assert.strictEqual(etiquetaFacturaPedido({ metodoPago: 'tarjeta', paymentStatus: 'pending', totalConEnvio: 5 }).text, 'Factura al confirmar pago');
}

// Entregar tarjeta sin pagar sale antes de tocar stats
{
  const i = html.indexOf('async function deliverOrder');
  const j = html.indexOf('async function undeliverOrder');
  const body = html.slice(i, j);
  assert.ok(body.includes('pedidoEsperaPagoTarjeta'));
  assert.ok(body.includes('Factura al confirmar pago'));
  assert.ok(body.includes('entregaCuentaProductos'));
  const guard = body.indexOf('pedidoEsperaPagoTarjeta(freshData)');
  const stats = body.indexOf('ingresosPedidos');
  assert.ok(guard > 0 && guard < stats, 'el guardia de pago va antes de las stats');
}

// Cancelar sigue reintegrando stock y solo anula facturas existentes
{
  const i = html.indexOf('async function cancelOrder');
  const j = html.indexOf('async function deleteOrder');
  const body = html.slice(i, j);
  assert.ok(body.includes('facturasParaAnular'));
  assert.ok(body.includes('anulada:true'));
  assert.ok(body.includes('stockDeducted'));
  assert.ok(body.includes("FieldValue.increment(item.qty||0)"));
  assert.ok(!body.includes(".collection('facturas').doc(),") && !/collection\('facturas'\)[\s\S]{0,80}\.set\(/.test(body));
}

// POS en efectivo sigue facturando al vender (no entra al plan de pedidos web)
{
  const i = html.indexOf('async function confirmarVenta');
  const j = html.indexOf('function productOrdenValue');
  const body = html.slice(i, j);
  assert.ok(body.includes('facturaSeq'));
  assert.ok(body.includes("collection('facturas')"));
  assert.ok(!body.includes('pedidoEsperaPagoTarjeta'));
}

console.log('pedido-factura-rules: ok');
