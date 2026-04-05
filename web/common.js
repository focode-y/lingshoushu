const token = localStorage.getItem('token');
if (!token && !location.pathname.endsWith('/login.html')) location.href = '/login.html';

function authHeaders(extra = {}) {
  return { ...extra, Authorization: 'Bearer ' + localStorage.getItem('token') };
}

async function api(url, method = 'GET', body) {
  const headers = authHeaders({ 'Content-Type': 'application/json' });
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { localStorage.removeItem('token'); location.href = '/login.html'; }
  return { ok: res.ok, data };
}

function shell(title, activeKey, innerHtml) {
  document.body.innerHTML = `
  <div class="app">
    <div class="nav-overlay" id="navOverlay" onclick="toggleNav()"></div>
    <aside class="side" id="sideNav">
      <div class="side-top">
        <div class="brand">票据SaaS</div>
        <button class="close-nav" onclick="toggleNav()" title="閉じる">✕</button>
      </div>
      <nav class="nav">
        <a class="${activeKey==='company'?'active':''}" href="/company.html">公司信息预设</a>
        <a class="${activeKey==='products'?'active':''}" href="/products.html">公司主要商品类目</a>
        <a class="${activeKey==='issue-request'?'active':''}" href="/issue-request.html">开请求书</a>
        <a class="${activeKey==='issue-receipt'?'active':''}" href="/issue-receipt.html">开领収书</a>
        <a class="${activeKey==='issue-delivery'?'active':''}" href="/issue-delivery.html">开纳品书</a>
        <a class="${activeKey==='request-list'?'active':''}" href="/request-list.html">请求书列表</a>
        <a class="${activeKey==='receipt-list'?'active':''}" href="/receipt-list.html">领収书列表</a>
        <a class="${activeKey==='delivery-list'?'active':''}" href="/delivery-list.html">纳品书列表</a>
        <a class="${activeKey==='ledger'?'active':''}" href="/ledger.html">总台账</a>
        <a class="${activeKey==='account'?'active':''}" href="/account.html">账号管理</a>
        <a class="${activeKey==='audit'?'active':''}" href="/audit.html">操作记录</a>
      </nav>
      <button style="margin-top:10px;width:100%" onclick="localStorage.removeItem('token');location.href='/login.html'">退出登录</button>
    </aside>
    <main class="main">
      <button class="hamburger" onclick="toggleNav()">☰</button>
      <div class="card"><h1>${title}</h1></div>
      ${innerHtml}
    </main>
  </div>`;
}

function toggleNav() {
  document.getElementById('sideNav').classList.toggle('open');
  document.getElementById('navOverlay').classList.toggle('open');
}

function fmt(n){return Number(n||0).toLocaleString('ja-JP');}
function docRowsToPayload(tbody){return [...tbody.querySelectorAll('tr')].map(tr=>({product_name:tr.querySelector('.name').value,qty:Number(tr.querySelector('.qty').value||0),tax_rate:Number(tr.querySelector('.tax').value||10),input_mode:tr.querySelector('.mode').value,unit_price_input:Number(tr.querySelector('.price').value||0)}));}
function addDocRow(tbody,v={product_name:'',qty:1,tax_rate:10,input_mode:'inclusive',unit_price_input:0}){const tr=document.createElement('tr');tr.innerHTML=`<td><input class='name' value="${v.product_name||''}"></td><td><input class='qty' type='number' value="${v.qty||1}"></td><td><select class='tax'><option value='10'>10%</option><option value='8'>8%</option></select></td><td><select class='mode'><option value='inclusive'>税込</option><option value='exclusive'>税抜</option></select></td><td><input class='price' type='number' value="${v.unit_price_input||0}"></td><td><button onclick='this.closest("tr").remove()'>删</button></td>`;tr.querySelector('.tax').value=String(v.tax_rate||10);tr.querySelector('.mode').value=v.input_mode||'inclusive';tbody.appendChild(tr);}
