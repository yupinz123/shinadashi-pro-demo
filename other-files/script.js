// script.js - スーパー品出しSPA
const CATEGORY_ORDER = ['水', 'お茶', 'ジュース', '炭酸', '大型飲料', 'コーヒー', 'その他', 'キッチン', 'ティッシュ', 'トイレットペーパー'];
const TAB_FILES = {
  drinks: 'drinks.csv',
  paper: 'paper.csv',
  dailyfoods: 'dailyfoods.csv',
  ice: 'ice.csv'
};
// 左タブ（回転式）の循環順。右タブが drinks 固定の前提。
const ROTATABLE_TABS = ['paper', 'dailyfoods', 'ice'];
const TAB_LABELS = { drinks: '飲料', paper: '紙類', dailyfoods: '日配', ice: 'アイス' };
// 各タブ毎のフィルタ仕様
// productsFilter: 商品画面のフィルタ種別（'location' / 'category' / null）
// tasksFilter: タスク画面のフィルタ種別（'category' / null）
// taskUI: タスク画面のUI種別（'drinks-style'=未運搬機能あり / 'paper-style'=運搬済+削除のみ）
const TAB_CONFIG = {
  drinks:     { productsFilter: 'location', tasksFilter: null,       taskUI: 'drinks-style' },
  paper:      { productsFilter: null,       tasksFilter: 'category', taskUI: 'paper-style'  },
  dailyfoods: { productsFilter: 'category', tasksFilter: 'category', taskUI: 'paper-style'  },
  ice:        { productsFilter: null,       tasksFilter: null,       taskUI: 'paper-style'  }
};

let currentTab = 'drinks';
let products = [];
let tasks = [];
let outOfStockItems = JSON.parse(localStorage.getItem('outOfStockItems') || '[]');
let outOfStockCounts = JSON.parse(localStorage.getItem('outOfStockCounts') || '{}');
let outOfStockRestoreStatus = JSON.parse(localStorage.getItem('outOfStockRestoreStatus') || '{}');
// 日配タブ用：在庫無に移したタスクの賞味期限を保持し、復元時に再現する
let outOfStockRestoreExpiry = JSON.parse(localStorage.getItem('outOfStockRestoreExpiry') || '{}');
window.searchKeyword = '';
window.drinksLocationFilter = null;
window.dailyfoodsCategoryFilter = null;

// --- CSV Utility ---
function parseCSV(text) {
  // Robust CSV parser that handles quoted fields containing commas and double-quotes
  const lines = text.trim().split(/\r?\n/);
  const parseLine = (line) => {
    const cols = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        // handle escaped quotes ""
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        cols.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    return cols;
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    if (!line.trim()) return null;
    const cols = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      let v = cols[i] || '';
      // remove surrounding quotes and unescape double quotes
      if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
        v = v.slice(1, -1).replace(/""/g, '"');
      }
      obj[h] = v;
    });
    obj.boxCount = Number(obj.boxCount) || 0;
    try { obj.tasks = obj.tasks ? JSON.parse(obj.tasks) : []; } catch (e) { obj.tasks = []; }
    obj.order = Number(obj.order) || 0;
    return obj;
  }).filter(Boolean);
}

// --- Data Load ---
async function loadProducts(tab) {
  // タブ切替直後に旧タブの商品が一瞬表示されるのを防ぐため、
  // CSV取得前に products を空にして即時に再描画する。
  products = [];
  renderProducts();
  renderTasks();
  const res = await fetch(TAB_FILES[tab]);
  const text = await res.text();
  // 取得完了時点でもう別タブに切り替わっていたら、結果を破棄する（競合対策）
  if (tab !== currentTab) return;
  // CSVのidが他タブと重複する可能性があるため、タブ名をプレフィックスにつけたuniqueIdを内部的に使う
  products = parseCSV(text).map(p => ({ ...p, _origId: p.id, id: `${tab}::${p.id}`, _tab: tab })).sort((a, b) => a.order - b.order);
  renderProducts();
  renderTasks();
}

// --- Product List ---
let taskCounts = {};
function updateTaskCounts() {
  taskCounts = {};
  tasks.forEach(t => {
    if (!taskCounts[t.id]) taskCounts[t.id] = 0;
    taskCounts[t.id]++;
  });
}

function renderProducts() {
  updateTaskCounts();
  const list = document.getElementById('product-list');
  list.innerHTML = '';
  // グループ化キー：日配はカテゴリでグループ化、それ以外は location でグループ化
  const groupKey = (currentTab === 'dailyfoods') ? 'category' : 'location';
  const grouped = {};
  const groupOrder = [];
  let customPaperOrder = ["キッチン用品", "レジ前", "トイレ用品"];
  let isPaperTab = currentTab === 'paper';
  products.forEach(prod => {
    const key = prod[groupKey];
    if (!grouped[key]) {
      grouped[key] = [];
      groupOrder.push(key);
    }
    grouped[key].push(prod);
  });
  let orderList = groupOrder;
  if (isPaperTab) {
    orderList = customPaperOrder.filter(loc => groupOrder.includes(loc)).concat(groupOrder.filter(loc => !customPaperOrder.includes(loc)));
  }
  orderList.forEach(groupName => {
    // 飲料商品画面の陳列場所フィルタ
    if (currentTab === 'drinks' && window.drinksLocationFilter && groupName !== window.drinksLocationFilter) return;
    // 日配商品画面のカテゴリフィルタ
    if (currentTab === 'dailyfoods' && window.dailyfoodsCategoryFilter && groupName !== window.dailyfoodsCategoryFilter) return;
    const heading = document.createElement('h2');
    heading.className = 'location-heading';
    heading.textContent = groupName;
    list.appendChild(heading);
    const gridDiv = document.createElement('div');
    gridDiv.className = 'product-grid';
    grouped[groupName].forEach(prod => {
      if (window.searchKeyword && !prod.name.toLowerCase().includes(window.searchKeyword)) return;
      const card = document.createElement('div');
      card.className = 'product-card';
      card.setAttribute('data-id', prod.id);
      if (outOfStockItems.includes(prod.id)) {
        card.classList.add('out-of-stock');
      }
      // 数量表示エリア
      let count = taskCounts[prod.id] || 0;
      let boxHtml = '';
      if (currentTab === 'drinks' || currentTab === 'dailyfoods') {
        // 飲料・日配：追加数表示（Count列なし）
        boxHtml = `<div class="product-box">追加数: ${count}</div>`;
      } else {
        // paper / ice の Count 列あり：N/可能数 表示
        let possible = Number(prod.Count) || 0;
        boxHtml = `<div class="product-box">${count}/${possible}</div>`;
      }
      card.innerHTML = `
        <img src="${prod.imageUrl}" alt="${prod.name}">
        <div class="product-name">${prod.name}</div>
        ${boxHtml}
      `;
      // 長押しGoogle検索機能
      let longPressTimer = null;
      let isLongPress = false;
  const LONG_PRESS_DURATION = 2000;
      const imgElem = card.querySelector('img');
      imgElem.addEventListener('mousedown', (e) => {
        if (outOfStockItems.includes(prod.id)) return;
        isLongPress = false;
        longPressTimer = setTimeout(() => {
          isLongPress = true;
          const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(prod.name);
          window.open(searchUrl, '_blank');
        }, LONG_PRESS_DURATION);
      });
      imgElem.addEventListener('mouseup', () => {
        clearTimeout(longPressTimer);
      });
      imgElem.addEventListener('mouseleave', () => {
        clearTimeout(longPressTimer);
      });
      imgElem.addEventListener('touchstart', (e) => {
        if (outOfStockItems.includes(prod.id)) return;
        isLongPress = false;
        longPressTimer = setTimeout(() => {
          isLongPress = true;
          const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(prod.name);
          window.open(searchUrl, '_blank');
        }, LONG_PRESS_DURATION);
      });
      imgElem.addEventListener('touchend', () => {
        clearTimeout(longPressTimer);
      });
      // 通常タップ（短押し）
      card.onclick = () => {
        if (outOfStockItems.includes(prod.id)) return;
        if (isLongPress) {
          isLongPress = false;
          return;
        }
        if (currentTab === 'dailyfoods') {
          // 同じ商品で、未運搬（=carried以外）のタスクが残っていれば、
          // その日付を流用してモーダルを出さずに即追加する。
          // 全部運搬済/削除済/リセット済なら、再度モーダルで日付入力を要求する。
          const existing = tasks.find(t => t.id === prod.id && t.status !== 'carried');
          if (existing && typeof existing.expiry !== 'undefined') {
            addTask(prod, existing.expiry);
            card.classList.add('touch-highlight');
            setTimeout(() => card.classList.remove('touch-highlight'), 350);
          } else {
            // 日配タブは賞味期限入力モーダルを開く（追加は確定時に実行）
            openExpiryModal(prod, card);
          }
        } else {
          addTask(prod);
          card.classList.add('touch-highlight');
          setTimeout(() => card.classList.remove('touch-highlight'), 350);
        }
      };
      gridDiv.appendChild(card);
    });
    list.appendChild(gridDiv);
  });
}

// タスク追加
// expiry: 日配タブで使用。'MMDD'形式の4桁文字列、または null（入力なし）。それ以外のタブでは undefined
function addTask(product, expiry) {
  const taskObj = { ...product, status: 'new', taskUid: Date.now() + Math.random() };
  if (typeof expiry !== 'undefined') {
    // null（入力なし）または 'MMDD' 文字列
    taskObj.expiry = expiry;
  }
  tasks.push(taskObj);
  if (!taskCounts[product.id]) taskCounts[product.id] = 0;
  taskCounts[product.id]++;
  saveTasks();
  renderTasks();
  renderProducts(); // 追加数即時反映
}

// 'MMDD'形式の文字列を 'M/D' 形式に変換して返す。空/null/不正なら null
function formatExpiry(mmdd) {
  if (!mmdd || typeof mmdd !== 'string' || mmdd.length !== 4) return null;
  const m = parseInt(mmdd.slice(0, 2), 10);
  const d = parseInt(mmdd.slice(2, 4), 10);
  if (isNaN(m) || isNaN(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${m}/${d}`;
}

// タスク削除
function deleteTask(taskUid) {
  const idx = tasks.findIndex(t => t.taskUid === taskUid);
  if (idx !== -1) {
    const id = tasks[idx].id;
    tasks.splice(idx, 1);
    if (taskCounts[id]) {
      taskCounts[id]--;
      if (taskCounts[id] <= 0) delete taskCounts[id];
    }
    saveTasks();
    renderTasks();
    renderProducts(); // 追加数即時反映
  }
}

// --- 日配タスク描画ヘルパー ---
// 日配のタスクを1件分、area に追加する。
// 賞味期限バッジ + 「運搬済 / 在庫無 / 削除」の3ボタンを表示する。
function renderDailyfoodsTaskItem(area, task) {
  const item = document.createElement('div');
  item.className = 'task-item';

  // 賞味期限バッジ HTML
  let expiryHtml = '';
  if (typeof task.expiry !== 'undefined') {
    if (task.expiry === null || task.expiry === '') {
      expiryHtml = '<span class="task-expiry-badge no-date">日付なし</span>';
    } else {
      const formatted = formatExpiry(task.expiry);
      if (formatted) {
        expiryHtml = `<span class="task-expiry-badge">${formatted}</span>`;
      }
    }
  }

  item.innerHTML = `
    <div class="task-item-content">
      <img class="task-img" src="${task.imageUrl}" alt="img">
      <div class="task-name">${task.name}${expiryHtml}</div>
    </div>
    <div class="task-buttons">
      <button class="carried-btn">運搬済</button>
      <button class="not-carried-btn">在庫無</button>
      <button class="delete-btn">削除</button>
    </div>`;

  // 運搬済ボタン
  item.querySelector('.carried-btn').onclick = () => {
    task.status = 'carried';
    saveTasks();
    renderTasks();
  };
  // 在庫無ボタン（飲料の未運搬→在庫無動作と同等）
  item.querySelector('.not-carried-btn').onclick = () => {
    if (!outOfStockItems.includes(task.id)) {
      outOfStockItems.push(task.id);
      const sameTasks = tasks.filter(t => t.id === task.id);
      outOfStockCounts[task.id] = sameTasks.length;
      outOfStockRestoreStatus[task.id] = sameTasks.map(t => t.status);
      // 賞味期限も保持して復元時に再現する
      outOfStockRestoreExpiry[task.id] = sameTasks.map(t => (typeof t.expiry !== 'undefined' ? t.expiry : undefined));
      localStorage.setItem('outOfStockItems', JSON.stringify(outOfStockItems));
      localStorage.setItem('outOfStockCounts', JSON.stringify(outOfStockCounts));
      localStorage.setItem('outOfStockRestoreStatus', JSON.stringify(outOfStockRestoreStatus));
      localStorage.setItem('outOfStockRestoreExpiry', JSON.stringify(outOfStockRestoreExpiry));
    }
    // 同一商品のタスクをまとめて削除
    tasks = tasks.filter(t => t.id !== task.id);
    saveTasks();
    renderTasks();
    renderProducts();
  };
  // 削除ボタン（このタスク1件のみ削除）
  item.querySelector('.delete-btn').onclick = () => {
    tasks = tasks.filter(t => t.taskUid !== task.taskUid);
    saveTasks();
    renderTasks();
    renderProducts();
  };

  area.appendChild(item);
}

// --- Task List ---
function renderTasks() {
  const area = document.getElementById('task-list');
  area.innerHTML = '';

  // 分類：通常、新規(=new), 未運搬(not-carried), 運搬済(carried)
  const normal = [];
  const notCarried = [];
  const carried = [];

  tasks.forEach(t => {
    // 現タブのタスクのみを表示する。_tab があればそれで判定し、
    // 無ければ id のプレフィックス（"<tab>::xxx"）で判定する（古い保存データ互換）。
    const taskTab = t._tab || (typeof t.id === 'string' && t.id.includes('::') ? t.id.split('::')[0] : null);
    if (taskTab && taskTab !== currentTab) return;
    // 紙/日配タブでカテゴリフィルタがある場合は適用
    if (currentTab === 'paper' && window.paperCategoryFilter && t.category !== window.paperCategoryFilter) return;
    if (currentTab === 'dailyfoods' && window.dailyfoodsCategoryFilter && t.category !== window.dailyfoodsCategoryFilter) return;
    // 検索フィルタ（紙タブでは検索を無効）
    if (currentTab !== 'paper' && window.searchKeyword && !t.name.toLowerCase().includes(window.searchKeyword)) return;
    if (t.status === 'carried') carried.push(t);
    else if (t.status === 'not-carried') notCarried.push(t);
    else normal.push(t);
  });

  // 表示順定義
  const drinkOrder = ['水', 'お茶', 'ジュース', '炭酸', '大型飲料', 'コーヒー', 'その他'];
  const paperOrder = ['キッチン', 'ティッシュ', 'トイレットペーパー'];
  const dailyfoodsOrder = ['常温飲料', '常温ゼリー', '卵'];
  const iceOrder = ['氷'];
  // タブごとの順序とUI種別
  const taskUI = (TAB_CONFIG[currentTab] && TAB_CONFIG[currentTab].taskUI) || 'drinks-style';
  const orderForTab = (
    currentTab === 'drinks' ? drinkOrder :
    currentTab === 'paper' ? paperOrder :
    currentTab === 'dailyfoods' ? dailyfoodsOrder :
    currentTab === 'ice' ? iceOrder : []
  );

  if (currentTab === 'drinks') {
    // 通常タスク（カテゴリ順）
    drinkOrder.forEach(cat => {
      const items = normal.filter(t => t.category === cat);
      if (!items.length) return;
      const catDiv = document.createElement('div');
      catDiv.className = 'task-category';
      catDiv.innerHTML = `<div class="task-category-title">${cat}</div>`;
      items.forEach(task => {
        const item = document.createElement('div');
        item.className = 'task-item';
        item.innerHTML = `
          <div class="task-item-content">
            <img class="task-img" src="${task.imageUrl}" alt="img">
            <div class="task-name">${task.name}</div>
          </div>
          <div class="task-buttons">
            <button class="carried-btn">運搬済</button>
            <button class="not-carried-btn">未運搬</button>
            <button class="delete-btn">削除</button>
          </div>`;
        item.querySelector('.carried-btn').onclick = () => { task.status = 'carried'; saveTasks(); renderTasks(); };
        item.querySelector('.not-carried-btn').onclick = () => { task.status = 'not-carried'; saveTasks(); renderTasks(); };
        item.querySelector('.delete-btn').onclick = () => { tasks = tasks.filter(t => t.taskUid !== task.taskUid); saveTasks(); renderTasks(); };
        catDiv.appendChild(item);
      });
      area.appendChild(catDiv);
    });

    // 未運搬エリア（通常タスクの下、在庫無の上）
    const hasNot = notCarried.length > 0;
    if (hasNot) {
      const notDiv = document.createElement('div');
      notDiv.className = 'out-stock-list';
      notDiv.innerHTML = '<div class="out-stock-title">未運搬商品</div>';
      drinkOrder.forEach(cat => {
        const items = notCarried.filter(t => t.category === cat);
        if (!items.length) return;
        items.forEach(task => {
          // 同じ見た目・UIにするため通常タスクと同様の構成にする
          const item = document.createElement('div');
          item.className = 'task-item';
          item.innerHTML = `
            <div class="task-item-content">
              <img class="task-img" src="${task.imageUrl}" alt="img">
              <div class="task-name">${task.name}</div>
            </div>
            <div class="task-buttons">
              <button class="carried-btn">運搬済</button>
              <button class="not-carried-btn">${task.status === 'not-carried' ? '在庫無' : '未運搬'}</button>
              <button class="delete-btn">削除</button>
            </div>`;
          // 各ボタンの挙動を通常タスクと同じにする
          item.querySelector('.carried-btn').onclick = () => { task.status = 'carried'; saveTasks(); renderTasks(); };
          item.querySelector('.not-carried-btn').onclick = () => {
            // 在庫無に移す
            if (!outOfStockItems.includes(task.id)) {
              outOfStockItems.push(task.id);
              const sameTasks = tasks.filter(t => t.id === task.id);
              outOfStockCounts[task.id] = sameTasks.length;
              outOfStockRestoreStatus[task.id] = sameTasks.map(t => t.status);
              localStorage.setItem('outOfStockItems', JSON.stringify(outOfStockItems));
              localStorage.setItem('outOfStockCounts', JSON.stringify(outOfStockCounts));
              localStorage.setItem('outOfStockRestoreStatus', JSON.stringify(outOfStockRestoreStatus));
            }
            renderProducts();
            tasks = tasks.filter(t => t.id !== task.id);
            saveTasks();
            renderTasks();
          };
          item.querySelector('.delete-btn').onclick = () => { tasks = tasks.filter(t2 => t2.taskUid !== task.taskUid); saveTasks(); renderTasks(); };
          notDiv.appendChild(item);
        });
      });
      area.appendChild(notDiv);
    }
  }

  // 在庫無（ドリンクのみ表示）
  if (currentTab === 'drinks') {
    // 他タブの在庫無 id が混じらないよう、現タブのプレフィックス（drinks::）で絞る
    const uniqueOutStock = Array.from(new Set(outOfStockItems)).filter(id => typeof id === 'string' && id.startsWith('drinks::'));
    if (uniqueOutStock.length > 0) {
      const outDiv = document.createElement('div');
      outDiv.className = 'out-stock-list';
      outDiv.innerHTML = '<div class="out-stock-title">在庫無商品</div>';
      uniqueOutStock.forEach(id => {
        const prod = products.find(p => p.id === id);
        if (!prod) return;
        const item = document.createElement('div');
        item.className = 'out-stock-item';
        item.innerHTML = `
          <img class="task-img" src="${prod.imageUrl}" alt="img">
          <span class="task-name">${prod.name}</span>`;
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'restore-btn';
        restoreBtn.textContent = 'タスクに戻す';
        restoreBtn.onclick = () => {
          outOfStockItems = outOfStockItems.filter(x => x !== id);
          localStorage.setItem('outOfStockItems', JSON.stringify(outOfStockItems));
          const restoreCount = outOfStockCounts[id] || 1;
          const restoreStatusArr = outOfStockRestoreStatus[id] || [];
          delete outOfStockCounts[id]; delete outOfStockRestoreStatus[id];
          localStorage.setItem('outOfStockCounts', JSON.stringify(outOfStockCounts));
          localStorage.setItem('outOfStockRestoreStatus', JSON.stringify(outOfStockRestoreStatus));
          for (let i = 0; i < restoreCount; i++) {
            const prodObj = products.find(p => p.id === id);
            if (prodObj) {
              const status = restoreStatusArr[i] || 'new';
              tasks.push({ ...prodObj, status, taskUid: Date.now() + Math.random() });
            }
          }
          saveTasks(); renderTasks(); renderProducts();
        };
        item.appendChild(restoreBtn);
        outDiv.appendChild(item);
      });
      area.appendChild(outDiv);
    }
  }

  // 日配タブ：個別タスク表示（賞味期限バッジ + 運搬済/在庫無/削除の3ボタン）
  // ※ 集約せず、追加した1件ごとに1行表示する（日付が異なるため）
  if (currentTab === 'dailyfoods') {
    // カテゴリ順に並べ替えて、未運搬（new）のタスクを表示
    dailyfoodsOrder.forEach(cat => {
      const items = normal.filter(t => t.category === cat);
      if (!items.length) return;
      items.forEach(task => {
        renderDailyfoodsTaskItem(area, task);
      });
    });
    // dailyfoodsOrder に含まれないカテゴリの保険
    const otherItems = normal.filter(t => !dailyfoodsOrder.includes(t.category));
    otherItems.forEach(task => renderDailyfoodsTaskItem(area, task));

    // 在庫無一覧（飲料と同様）
    // 他タブの在庫無 id が混じらないよう、現タブ（dailyfoods::）プレフィックスのみ表示する
    const uniqueOutStock = Array.from(new Set(outOfStockItems)).filter(id => typeof id === 'string' && id.startsWith('dailyfoods::'));
    if (uniqueOutStock.length > 0) {
      const outDiv = document.createElement('div');
      outDiv.className = 'out-stock-list';
      outDiv.innerHTML = '<div class="out-stock-title">在庫無商品</div>';
      uniqueOutStock.forEach(id => {
        const prod = products.find(p => p.id === id);
        if (!prod) return;
        const item = document.createElement('div');
        item.className = 'out-stock-item';
        item.innerHTML = `
          <img class="task-img" src="${prod.imageUrl}" alt="img">
          <span class="task-name">${prod.name}</span>`;
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'restore-btn';
        restoreBtn.textContent = 'タスクに戻す';
        restoreBtn.onclick = () => {
          outOfStockItems = outOfStockItems.filter(x => x !== id);
          localStorage.setItem('outOfStockItems', JSON.stringify(outOfStockItems));
          const restoreCount = outOfStockCounts[id] || 1;
          const restoreStatusArr = outOfStockRestoreStatus[id] || [];
          const restoreExpiryArr = (outOfStockRestoreExpiry && outOfStockRestoreExpiry[id]) || [];
          delete outOfStockCounts[id]; delete outOfStockRestoreStatus[id];
          if (outOfStockRestoreExpiry) delete outOfStockRestoreExpiry[id];
          localStorage.setItem('outOfStockCounts', JSON.stringify(outOfStockCounts));
          localStorage.setItem('outOfStockRestoreStatus', JSON.stringify(outOfStockRestoreStatus));
          localStorage.setItem('outOfStockRestoreExpiry', JSON.stringify(outOfStockRestoreExpiry || {}));
          for (let i = 0; i < restoreCount; i++) {
            const prodObj = products.find(p => p.id === id);
            if (prodObj) {
              const status = restoreStatusArr[i] || 'new';
              const restoreObj = { ...prodObj, status, taskUid: Date.now() + Math.random() };
              if (typeof restoreExpiryArr[i] !== 'undefined') {
                restoreObj.expiry = restoreExpiryArr[i];
              }
              tasks.push(restoreObj);
            }
          }
          saveTasks(); renderTasks(); renderProducts();
        };
        item.appendChild(restoreBtn);
        outDiv.appendChild(item);
      });
      area.appendChild(outDiv);
    }
  }

  // 紙/日配/アイスタブの特別表示：集約表示（同IDを1行にまとめ、カウント表示）
  // ※ 日配タブは上で個別表示を行うため、ここではスキップする
  if (taskUI === 'paper-style' && currentTab !== 'dailyfoods') {
    // 集約対象：現タブのタスクの ids のみを対象にする
    const currentTabTasks = tasks.filter(t => {
      const taskTab = t._tab || (typeof t.id === 'string' && t.id.includes('::') ? t.id.split('::')[0] : null);
      return !taskTab || taskTab === currentTab;
    });
    const ids = Array.from(new Set(currentTabTasks.map(t => t.id)));
    // カテゴリ選択がある場合、さらに絞る
    const filteredIds = ids.filter(id => {
      const prod = products.find(p => p.id === id);
      if (!prod) return false;
      if (currentTab === 'paper' && window.paperCategoryFilter && prod.category !== window.paperCategoryFilter) return false;
      if (currentTab === 'dailyfoods' && window.dailyfoodsCategoryFilter && prod.category !== window.dailyfoodsCategoryFilter) return false;
      return true;
    });
    filteredIds.forEach(id => {
      const prod = products.find(p => p.id === id);
      if (!prod) return;
      const totalAdded = taskCounts[id] || tasks.filter(t => t.id === id).length;
      const carriedCount = tasks.filter(t => t.id === id && t.status === 'carried').length;
      // すでに全数運搬済ならこの行を表示せず、運搬済欄へ移動させる
      if (carriedCount >= totalAdded && totalAdded > 0) return;
      const item = document.createElement('div');
      item.className = 'task-item';
      item.innerHTML = `
        <div class="task-item-content">
          <img class="task-img" src="${prod.imageUrl}" alt="img">
          <div class="task-name">${prod.name}</div>
        </div>`;
      // ボタン：運搬済・削除のみ
      const btnWrap = document.createElement('div'); btnWrap.className = 'task-buttons';
      const carriedBtn = document.createElement('button'); carriedBtn.className = 'carried-btn'; carriedBtn.textContent = '運搬済';
      carriedBtn.onclick = () => {
        // 一つだけ未運搬/newのタスクを運搬済にする（カウントアップ）
        const target = tasks.find(t => t.id === id && t.status !== 'carried');
        if (target) {
          target.status = 'carried';
          saveTasks();
          renderTasks();
        }
      };
      const delBtn = document.createElement('button'); delBtn.className = 'delete-btn'; delBtn.textContent = '削除';
      delBtn.onclick = () => {
        tasks = tasks.filter(t => t.id !== id);
        taskCounts[id] = 0;
        saveTasks(); renderTasks(); renderProducts();
      };
  btnWrap.appendChild(carriedBtn);
  btnWrap.appendChild(delBtn);
      item.appendChild(btnWrap);
      // カウント表示（削除ボタンの下）
      const countEl = document.createElement('div');
      countEl.style.textAlign = 'center';
      countEl.style.fontSize = '0.95rem';
      countEl.style.color = '#888';
      countEl.textContent = `${carriedCount}/${totalAdded}`;
      item.appendChild(countEl);
      area.appendChild(item);
    });
    // 集約タブでは在庫無リストは表示しない（紙類同様）
    // NOTE: ここで return しない。下の「運搬済一覧」描画のため。
  }

  // --- 紙/アイスタブ：未運搬商品をカテゴリごとに表示（来ないはずだが互換のため残す） ---
  // ※ 日配は上で個別表示済みなので除外
  if (taskUI === 'paper-style' && currentTab !== 'dailyfoods') {
    const hasNotPaper = notCarried.length > 0;
    if (hasNotPaper) {
      const notDiv = document.createElement('div');
      notDiv.className = 'out-stock-list';
      notDiv.innerHTML = '<div class="out-stock-title">未運搬商品</div>';
      orderForTab.forEach(cat => {
        const items = notCarried.filter(t => t.category === cat);
        if (!items.length) return;
        items.forEach(task => {
          const item = document.createElement('div');
          item.className = 'task-item';
          item.innerHTML = `
            <div class="task-item-content">
              <img class="task-img" src="${task.imageUrl}" alt="img">
              <div class="task-name">${task.name}</div>
            </div>
            <div class="task-buttons">
              <button class="carried-btn">運搬済</button>
              <button class="not-carried-btn">${task.status === 'not-carried' ? '在庫無' : '未運搬'}</button>
              <button class="delete-btn">削除</button>
            </div>`;
          item.querySelector('.carried-btn').onclick = () => { task.status = 'carried'; saveTasks(); renderTasks(); };
          item.querySelector('.not-carried-btn').onclick = () => {
            if (!outOfStockItems.includes(task.id)) {
              outOfStockItems.push(task.id);
              const sameTasks = tasks.filter(t => t.id === task.id);
              outOfStockCounts[task.id] = sameTasks.length;
              outOfStockRestoreStatus[task.id] = sameTasks.map(t => t.status);
              localStorage.setItem('outOfStockItems', JSON.stringify(outOfStockItems));
              localStorage.setItem('outOfStockCounts', JSON.stringify(outOfStockCounts));
              localStorage.setItem('outOfStockRestoreStatus', JSON.stringify(outOfStockRestoreStatus));
            }
            renderProducts();
            tasks = tasks.filter(t => t.id !== task.id);
            saveTasks();
            renderTasks();
          };
          item.querySelector('.delete-btn').onclick = () => { tasks = tasks.filter(t2 => t2.taskUid !== task.taskUid); saveTasks(); renderTasks(); };
          notDiv.appendChild(item);
        });
      });
      area.appendChild(notDiv);
    }
  }

  // 運搬済タスク一覧（カテゴリ順）
  if (carried.length > 0) {
    const carriedDiv = document.createElement('div');
    carriedDiv.className = 'out-stock-list';
    carriedDiv.innerHTML = '<div class="out-stock-title">運搬済商品</div>';
    const grouped = {};
    carried.forEach(t => { if (!grouped[t.category]) grouped[t.category] = []; grouped[t.category].push(t); });
    const showCats = orderForTab;
    showCats.forEach(cat => {
      if (!grouped[cat]) return;
      grouped[cat].forEach(task => {
        const item = document.createElement('div');
        item.className = 'out-stock-item carried';
        item.innerHTML = `
          <img class="task-img" src="${task.imageUrl}" alt="img">
          <span class="task-name">${task.name}</span>`;
        const delBtn = document.createElement('button'); delBtn.className = 'delete-btn'; delBtn.textContent = '削除';
        delBtn.onclick = () => { tasks = tasks.filter(t2 => t2.taskUid !== task.taskUid); saveTasks(); renderTasks(); };
        const notBtn = document.createElement('button'); notBtn.className = 'not-carried-btn'; notBtn.textContent = '未運搬';
        notBtn.onclick = () => { task.status = 'new'; saveTasks(); renderTasks(); };
        const btns = document.createElement('div'); btns.className = 'carried-task-buttons'; btns.appendChild(delBtn); btns.appendChild(notBtn);
        item.appendChild(btns);
        carriedDiv.appendChild(item);
      });
    });
    area.appendChild(carriedDiv);
  }
}

// --- 日配 賞味期限入力モーダル制御 ---
let _expiryModalCurrentProduct = null;
let _expiryModalCurrentCard = null;

function openExpiryModal(product, cardEl) {
  _expiryModalCurrentProduct = product;
  _expiryModalCurrentCard = cardEl || null;
  const modal = document.getElementById('expiry-modal');
  const img = document.getElementById('expiry-modal-img');
  const nameEl = document.getElementById('expiry-modal-name');
  const input = document.getElementById('expiry-input');
  const errorEl = document.getElementById('expiry-modal-error');
  if (img) img.src = product.imageUrl || '';
  if (img) img.alt = product.name || '';
  if (nameEl) nameEl.textContent = product.name || '';
  if (input) input.value = '';
  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
  modal.style.display = 'flex';
  // フォーカス（モバイルで自動的に数字キーパッドが開く）
  setTimeout(() => { if (input) input.focus(); }, 50);
}

function closeExpiryModal() {
  const modal = document.getElementById('expiry-modal');
  modal.style.display = 'none';
  _expiryModalCurrentProduct = null;
  _expiryModalCurrentCard = null;
}

function confirmExpiryAdd() {
  const input = document.getElementById('expiry-input');
  const errorEl = document.getElementById('expiry-modal-error');
  if (!_expiryModalCurrentProduct) { closeExpiryModal(); return; }
  const raw = (input && input.value || '').trim();
  if (raw.length !== 4 || !/^\d{4}$/.test(raw)) {
    if (errorEl) {
      errorEl.textContent = '4桁の数字を入力してください（例: 0914）';
      errorEl.style.display = '';
    }
    return;
  }
  const formatted = formatExpiry(raw);
  if (!formatted) {
    if (errorEl) {
      errorEl.textContent = '日付が正しくありません（月: 01〜12, 日: 01〜31）';
      errorEl.style.display = '';
    }
    return;
  }
  const prod = _expiryModalCurrentProduct;
  const card = _expiryModalCurrentCard;
  addTask(prod, raw);
  if (card) {
    card.classList.add('touch-highlight');
    setTimeout(() => card.classList.remove('touch-highlight'), 350);
  }
  closeExpiryModal();
}

function skipExpiryAdd() {
  if (!_expiryModalCurrentProduct) { closeExpiryModal(); return; }
  const prod = _expiryModalCurrentProduct;
  const card = _expiryModalCurrentCard;
  addTask(prod, null); // 入力なしで追加
  if (card) {
    card.classList.add('touch-highlight');
    setTimeout(() => card.classList.remove('touch-highlight'), 350);
  }
  closeExpiryModal();
}

// --- タスク保存・リセット ---
function saveTasks() {
  localStorage.setItem('tasks', JSON.stringify(tasks));
}
function loadTasks() {
  const t = localStorage.getItem('tasks');
  tasks = t ? JSON.parse(t) : [];
}

// --- フィルタボタン表示制御 ---
function updateFilterButtons() {
  const filterArea = document.getElementById('filter-buttons');
  const drinksLocBtns = document.getElementById('drinks-loc-buttons');
  const paperCatBtns = document.getElementById('paper-cat-buttons');
  const dailyfoodsCatBtns = document.getElementById('dailyfoods-cat-buttons');
  const searchBox = document.getElementById('search-box');
  const isTaskView = document.getElementById('subtab-tasks').classList.contains('active');

  // 全部非表示にリセット
  filterArea.style.display = 'none';
  drinksLocBtns.style.display = 'none';
  paperCatBtns.style.display = 'none';
  if (dailyfoodsCatBtns) dailyfoodsCatBtns.style.display = 'none';
  if (searchBox) searchBox.style.display = '';

  if (currentTab === 'drinks' && !isTaskView) {
    // 飲料の商品画面：陳列場所フィルタ表示
    filterArea.style.display = '';
    drinksLocBtns.style.display = '';
  } else if (currentTab === 'paper' && isTaskView) {
    // 紙類のタスク画面：カテゴリフィルタ表示、検索非表示
    filterArea.style.display = '';
    paperCatBtns.style.display = '';
    if (searchBox) searchBox.style.display = 'none';
  } else if (currentTab === 'dailyfoods') {
    // 日配は商品画面・タスク画面どちらでもカテゴリフィルタを表示
    filterArea.style.display = '';
    if (dailyfoodsCatBtns) dailyfoodsCatBtns.style.display = '';
    // タスク画面では紙類同様、検索ボックスを非表示にする
    if (isTaskView && searchBox) searchBox.style.display = 'none';
  } else if (currentTab === 'ice' && isTaskView) {
    // アイスのタスク画面：フィルタなし。検索は紙類同様、非表示にする（仕様：紙類のタスク画面に合わせる箇所はUIのみ）
    if (searchBox) searchBox.style.display = 'none';
  }
  // 飲料タスク画面・紙類商品画面・アイス商品画面：フィルタ非表示（デフォルト）
}

// --- タブ切り替え ---
function setTab(tab) {
  currentTab = tab;
  const leftTab = document.getElementById('tab-rotatable-left');
  const rightTab = document.getElementById('tab-rotatable-right');
  // どちらの側のタブをアクティブにするか決める：data-tab が一致する方を優先
  // 一致していなければ、現在アクティブな側のラベルを更新する（クリック由来の場合）
  let activeSide = null;
  if (leftTab.getAttribute('data-tab') === tab) activeSide = 'left';
  else if (rightTab.getAttribute('data-tab') === tab) activeSide = 'right';
  else {
    // どちらにも一致しない場合：現在のアクティブ側を採用、なければ右
    activeSide = leftTab.classList.contains('active') ? 'left' : 'right';
    const sideTab = activeSide === 'left' ? leftTab : rightTab;
    sideTab.setAttribute('data-tab', tab);
    const labelEl = sideTab.querySelector('.rotatable-label');
    if (labelEl) labelEl.textContent = TAB_LABELS[tab];
    // もう一方が重複していたら、そちらを次へずらす
    const other = activeSide === 'left' ? rightTab : leftTab;
    if (other.getAttribute('data-tab') === tab) {
      const ALL = ['drinks', 'paper', 'dailyfoods', 'ice'];
      const opts = ALL.filter(t => t !== tab);
      let idx = opts.indexOf(other.getAttribute('data-tab'));
      if (idx < 0) idx = 0;
      idx = (idx + 1) % opts.length;
      const newOther = opts[idx];
      other.setAttribute('data-tab', newOther);
      const otherLabel = other.querySelector('.rotatable-label');
      if (otherLabel) otherLabel.textContent = TAB_LABELS[newOther];
    }
  }
  // active状態を反映
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-pressed', 'false');
  });
  const sideTab = activeSide === 'left' ? leftTab : rightTab;
  sideTab.classList.add('active');
  sideTab.setAttribute('aria-pressed', 'true');

  // タブ切替時にフィルタリセット
  window.drinksLocationFilter = null;
  window.paperCategoryFilter = null;
  window.dailyfoodsCategoryFilter = null;
  // フィルタボタンのactive状態リセット
  document.querySelectorAll('.drinks-loc-btn').forEach(b => b.classList.remove('active'));
  const allDrinks = document.querySelector('.drinks-loc-btn[data-loc="all"]');
  if (allDrinks) allDrinks.classList.add('active');
  document.querySelectorAll('.paper-cat-btn').forEach(b => b.classList.remove('active'));
  const allPaper = document.querySelector('.paper-cat-btn[data-cat="all"]');
  if (allPaper) allPaper.classList.add('active');
  document.querySelectorAll('.dailyfoods-cat-btn').forEach(b => b.classList.remove('active'));
  const allDF = document.querySelector('.dailyfoods-cat-btn[data-cat="all"]');
  if (allDF) allDF.classList.add('active');
  updateFilterButtons();
  loadProducts(tab);
}

function hideAuxiliaryAreas() {
  document.getElementById('chatbot-area').style.display = 'none';
  document.getElementById('manual-area').style.display = 'none';
  document.getElementById('instruction-area').style.display = 'none';
}

function restoreDefaultView() {
  hideAuxiliaryAreas();
  document.getElementById('product-list').style.display = '';
  document.getElementById('task-list').style.display = 'none';
  document.getElementById('subtab-products').classList.add('active');
  document.getElementById('subtab-tasks').classList.remove('active');
  // 既存のタブ data-tab を尊重し、飲料が選ばれている側をアクティブにする
  const leftTab = document.getElementById('tab-rotatable-left');
  const rightTab = document.getElementById('tab-rotatable-right');
  if (leftTab) leftTab.classList.remove('active');
  if (rightTab) rightTab.classList.remove('active');
  // 飲料がどちらの side にもなければ右側を飲料に設定
  const leftVal = leftTab ? leftTab.getAttribute('data-tab') : null;
  const rightVal = rightTab ? rightTab.getAttribute('data-tab') : null;
  if (leftVal !== 'drinks' && rightVal !== 'drinks' && rightTab) {
    // 右側を drinks に設定し、左が drinks と重ならないように調整
    rightTab.setAttribute('data-tab', 'drinks');
    const rl = rightTab.querySelector('.rotatable-label');
    if (rl) rl.textContent = TAB_LABELS['drinks'];
    if (leftTab && leftTab.getAttribute('data-tab') === 'drinks') {
      // 左を次の候補に
      const opts = ['paper', 'dailyfoods', 'ice'];
      leftTab.setAttribute('data-tab', opts[0]);
      const ll = leftTab.querySelector('.rotatable-label');
      if (ll) ll.textContent = TAB_LABELS[opts[0]];
    }
  }
  document.getElementById('search-box').style.display = '';
  currentTab = 'drinks';
  updateFilterButtons();
  loadProducts(currentTab);
  // 適切な側に active を付与
  const reLeft = document.getElementById('tab-rotatable-left');
  const reRight = document.getElementById('tab-rotatable-right');
  if (reLeft && reLeft.getAttribute('data-tab') === 'drinks') reLeft.classList.add('active');
  else if (reRight && reRight.getAttribute('data-tab') === 'drinks') reRight.classList.add('active');
}

// --- 初期化 ---
document.addEventListener('DOMContentLoaded', () => {
  // ダーク/ライトモード初期化
  const themeToggle = document.getElementById('theme-toggle');
  const body = document.body;
  // localStorageから取得
  const savedTheme = localStorage.getItem('themeMode');
  if (savedTheme === 'dark') {
    body.classList.add('dark-mode');
    themeToggle.checked = true;
  } else {
    body.classList.remove('dark-mode');
    themeToggle.checked = false;
  }
  // トグル操作
  if (themeToggle) {
    themeToggle.addEventListener('change', (e) => {
      if (themeToggle.checked) {
        body.classList.add('dark-mode');
        localStorage.setItem('themeMode', 'dark');
      } else {
        body.classList.remove('dark-mode');
        localStorage.setItem('themeMode', 'light');
      }
    });
  }
  // タスクタブ表示制御
  document.getElementById('subtab-tasks').onclick = () => {
    document.getElementById('product-list').style.display = 'none';
    document.getElementById('task-list').style.display = '';
    document.getElementById('subtab-products').classList.remove('active');
    document.getElementById('subtab-tasks').classList.add('active');
    updateFilterButtons();
    renderTasks();
  };
  document.getElementById('subtab-products').onclick = () => {
    document.getElementById('product-list').style.display = '';
    document.getElementById('task-list').style.display = 'none';
    document.getElementById('subtab-products').classList.add('active');
    document.getElementById('subtab-tasks').classList.remove('active');
    updateFilterButtons();
  };
  // 飲料陳列場所ボタンのクリックイベント
  document.querySelectorAll('.drinks-loc-btn').forEach(b => {
    b.addEventListener('click', (e) => {
      const loc = e.currentTarget.getAttribute('data-loc');
      window.drinksLocationFilter = loc === 'all' ? null : loc;
      document.querySelectorAll('.drinks-loc-btn').forEach(x => x.classList.remove('active'));
      e.currentTarget.classList.add('active');
      renderProducts();
    });
  });
  // 紙カテゴリボタン群のクリックイベント
  document.querySelectorAll('.paper-cat-btn').forEach(b => {
    b.addEventListener('click', (e) => {
      const cat = e.currentTarget.getAttribute('data-cat');
      window.paperCategoryFilter = cat === 'all' ? null : cat;
      document.querySelectorAll('.paper-cat-btn').forEach(x => x.classList.remove('active'));
      e.currentTarget.classList.add('active');
      renderTasks();
    });
  });
  // 日配カテゴリボタン群のクリックイベント（商品画面・タスク画面共通）
  document.querySelectorAll('.dailyfoods-cat-btn').forEach(b => {
    b.addEventListener('click', (e) => {
      const cat = e.currentTarget.getAttribute('data-cat');
      window.dailyfoodsCategoryFilter = cat === 'all' ? null : cat;
      document.querySelectorAll('.dailyfoods-cat-btn').forEach(x => x.classList.remove('active'));
      e.currentTarget.classList.add('active');
      renderProducts();
      renderTasks();
    });
  });
  // 設定ボタン
  document.getElementById('settings-btn').onclick = () => {
    document.getElementById('settings-modal').style.display = 'flex';
  };
  document.getElementById('close-settings').onclick = () => {
    document.getElementById('settings-modal').style.display = 'none';
  };
  // チャットサポートボタン
  document.getElementById('chatbot-btn').onclick = () => {
    document.getElementById('settings-modal').style.display = 'none';
    document.getElementById('product-list').style.display = 'none';
    document.getElementById('task-list').style.display = 'none';
    hideAuxiliaryAreas();
    document.getElementById('chatbot-area').style.display = '';
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.subtab').forEach(st => st.classList.remove('active'));
    document.getElementById('filter-buttons').style.display = 'none';
    document.getElementById('search-box').style.display = 'none';
  };
  // マニュアルボタン
  document.getElementById('manual-btn').onclick = () => {
    document.getElementById('settings-modal').style.display = 'none';
    document.getElementById('product-list').style.display = 'none';
    document.getElementById('task-list').style.display = 'none';
    hideAuxiliaryAreas();
    document.getElementById('manual-area').style.display = '';
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.subtab').forEach(st => st.classList.remove('active'));
    document.getElementById('filter-buttons').style.display = 'none';
    document.getElementById('search-box').style.display = 'none';
  };
  // 取扱説明書ボタン
  document.getElementById('instruction-btn').onclick = () => {
    document.getElementById('settings-modal').style.display = 'none';
    document.getElementById('product-list').style.display = 'none';
    document.getElementById('task-list').style.display = 'none';
    hideAuxiliaryAreas();
    document.getElementById('instruction-area').style.display = '';
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.subtab').forEach(st => st.classList.remove('active'));
    document.getElementById('filter-buttons').style.display = 'none';
    document.getElementById('search-box').style.display = 'none';
  };
  // マニュアル閉じるボタン
  document.getElementById('close-manual-btn').onclick = () => {
    restoreDefaultView();
  };
  // 取扱説明書閉じるボタン
  document.getElementById('close-instruction-btn').onclick = () => {
    restoreDefaultView();
  };
  // チャットボット閉じるボタン
  document.getElementById('close-chatbot-btn').onclick = () => {
    restoreDefaultView();
  };
  document.getElementById('reset-btn').onclick = () => {
  localStorage.removeItem('tasks');
  localStorage.removeItem('outOfStockItems');
  localStorage.removeItem('outOfStockCounts');
  localStorage.removeItem('outOfStockRestoreStatus');
  localStorage.removeItem('outOfStockRestoreExpiry');
    tasks = [];
    outOfStockItems = [];
    outOfStockCounts = {};
    outOfStockRestoreStatus = {};
    outOfStockRestoreExpiry = {};
    renderProducts();
    renderTasks();
    document.getElementById('settings-modal').style.display = 'none';
  };
  // --- タブ ---
  // 両タブ（左:rotatable-left / 右:rotatable-right）共に回転式
  // 全タブから、もう一方が選んでいるものを除外してローテーション対象にする
  const ALL_TABS = ['drinks', 'paper', 'dailyfoods', 'ice'];
  const leftTab = document.getElementById('tab-rotatable-left');
  const rightTab = document.getElementById('tab-rotatable-right');

  // 矢印インジケータの一時アニメーション（初回ヒント表示）
  const showRotHint = () => {
    [leftTab, rightTab].forEach(tab => {
      const upArrow = tab.querySelector('.rotatable-arrow-up');
      const downArrow = tab.querySelector('.rotatable-arrow-down');
      if (upArrow) upArrow.classList.add('hint');
      if (downArrow) downArrow.classList.add('hint');
      setTimeout(() => {
        if (upArrow) upArrow.classList.remove('hint');
        if (downArrow) downArrow.classList.remove('hint');
      }, 2600);
    });
  };
  // 初回ヒント（localStorageで一度だけ）
  if (!localStorage.getItem('rotatableTabHintShown')) {
    setTimeout(showRotHint, 600);
    localStorage.setItem('rotatableTabHintShown', '1');
  }

  // あるタブの「ローテーション対象リスト」を返す（もう一方のタブの値を除外）
  const getRotateOptions = (tab) => {
    const otherTab = (tab === leftTab) ? rightTab : leftTab;
    const otherVal = otherTab.getAttribute('data-tab');
    return ALL_TABS.filter(t => t !== otherVal);
  };

  // タブを次/前に循環させる
  // tab: 操作対象のタブ要素
  // direction: +1=次, -1=前
  // andActivate: true なら setTab() してアクティブにする。false ならラベル更新のみ
  const rotateTab = (tab, direction, andActivate) => {
    const labelEl = tab.querySelector('.rotatable-label');
    const options = getRotateOptions(tab);
    const cur = tab.getAttribute('data-tab');
    let idx = options.indexOf(cur);
    if (idx < 0) idx = 0;
    idx = (idx + direction + options.length) % options.length;
    const next = options[idx];
    tab.setAttribute('data-tab', next);
    // アニメーション（方向に応じて上下スライド）
    if (labelEl) {
      labelEl.classList.remove('swipe-up', 'swipe-down');
      void labelEl.offsetWidth; // 強制リフロー
      labelEl.classList.add(direction > 0 ? 'swipe-up' : 'swipe-down');
      setTimeout(() => {
        labelEl.textContent = TAB_LABELS[next];
        labelEl.classList.remove('swipe-up', 'swipe-down');
      }, 160);
    }
    if (andActivate) {
      // ローテーションアニメ（170ms）中に旧タブの商品がタップされるのを防ぐため、
      // 切替が決定した瞬間に商品リストを空にして再描画する。
      // 実際のCSV読み込みはこの後 setTab → loadProducts で行われる。
      if (next !== currentTab) {
        products = [];
        try { renderProducts(); renderTasks(); } catch (e) {}
      }
      setTimeout(() => setTab(next), 170);
    }
  };

  // タブの初期表示が、もう一方と重複しているケースを修正する
  // （初期HTMLでは left=paper / right=drinks なので衝突しないが、念のため）
  const ensureNoOverlap = () => {
    if (leftTab.getAttribute('data-tab') === rightTab.getAttribute('data-tab')) {
      // 左タブを次へずらす
      rotateTab(leftTab, 1, false);
    }
  };

  // 一方のタブの値が変わったら、もう一方のラベルが重複していないかをチェックし、
  // 必要なら反対側のタブを次の値にずらす
  const syncOtherSideIfOverlap = (changedTab) => {
    const other = (changedTab === leftTab) ? rightTab : leftTab;
    if (other.getAttribute('data-tab') === changedTab.getAttribute('data-tab')) {
      // 重複しているので、もう一方を次へずらす（andActivate=false：見た目だけ更新）
      rotateTab(other, 1, false);
    }
  };

  // 各タブにイベントを取り付ける
  const attachRotatableHandlers = (tab) => {
    // クリック：今表示中のタブに切替 / すでにアクティブなら次へローテーション
    tab.addEventListener('click', (e) => {
      if (tab._suppressClick) {
        tab._suppressClick = false;
        return;
      }
      const isActive = tab.classList.contains('active');
      const dataTab = tab.getAttribute('data-tab');
      if (isActive && currentTab === dataTab) {
        rotateTab(tab, 1, true);
      } else {
        setTab(dataTab);
      }
    });

    // ホイール（PCマウス・タッチパッド）：上下スクロールでローテーション
    let wheelLock = false;
    tab.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (wheelLock) return;
      wheelLock = true;
      setTimeout(() => { wheelLock = false; }, 220);
      const dir = (e.deltaY > 0 || e.deltaX > 0) ? 1 : -1;
      const isActive = tab.classList.contains('active') && currentTab === tab.getAttribute('data-tab');
      rotateTab(tab, dir, isActive);
    }, { passive: false });

    // タッチ：スワイプでローテーション
    let touchStartX = null, touchStartY = null;
    tab.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    tab.addEventListener('touchend', (e) => {
      if (touchStartX === null) return;
      const t = (e.changedTouches && e.changedTouches[0]) || null;
      if (!t) { touchStartX = touchStartY = null; return; }
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;
      const absX = Math.abs(dx), absY = Math.abs(dy);
      const SWIPE_THRESHOLD = 24;
      if (Math.max(absX, absY) >= SWIPE_THRESHOLD) {
        tab._suppressClick = true;
        let dir;
        // 縦スワイプ：下方向→次、上方向→前
        // 横スワイプ：右→前、左→次
        if (absY >= absX) {
          dir = dy > 0 ? 1 : -1;
        } else {
          dir = dx > 0 ? -1 : 1;
        }
        const isActive = tab.classList.contains('active') && currentTab === tab.getAttribute('data-tab');
        rotateTab(tab, dir, isActive);
      }
      touchStartX = touchStartY = null;
    });
  };
  attachRotatableHandlers(leftTab);
  attachRotatableHandlers(rightTab);
  ensureNoOverlap();
  // 検索ボックス
  const searchBox = document.getElementById('search-box');
  if (searchBox) {
    searchBox.addEventListener('input', e => {
      window.searchKeyword = e.target.value.trim().toLowerCase();
      renderProducts();
      renderTasks();
    });
  }
  // データ
  loadProducts(currentTab);
  loadTasks();
  renderTasks();

  // --- 日配 賞味期限入力モーダルのイベント ---
  const expiryAddBtn = document.getElementById('expiry-add-btn');
  const expirySkipBtn = document.getElementById('expiry-skip-btn');
  const expiryCancelBtn = document.getElementById('expiry-cancel-btn');
  const expiryInput = document.getElementById('expiry-input');
  const expiryModal = document.getElementById('expiry-modal');
  if (expiryAddBtn) expiryAddBtn.addEventListener('click', confirmExpiryAdd);
  if (expirySkipBtn) expirySkipBtn.addEventListener('click', skipExpiryAdd);
  if (expiryCancelBtn) expiryCancelBtn.addEventListener('click', closeExpiryModal);
  // 数字以外をその場で除去 + 4桁入力で自動的にフォーカスを保持
  if (expiryInput) {
    expiryInput.addEventListener('input', (e) => {
      const v = e.target.value.replace(/\D/g, '').slice(0, 4);
      if (v !== e.target.value) e.target.value = v;
      // エラー表示をクリア
      const errorEl = document.getElementById('expiry-modal-error');
      if (errorEl) errorEl.style.display = 'none';
    });
    // Enterキーで決定
    expiryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmExpiryAdd();
      }
    });
  }
  // モーダル背景クリックで閉じる
  if (expiryModal) {
    expiryModal.addEventListener('click', (e) => {
      if (e.target === expiryModal) closeExpiryModal();
    });
  }
});

// ページトップへ戻るボタン
window.addEventListener('scroll', () => {
  const btn = document.getElementById('scrollTopBtn');
  if (btn) {
    if (window.scrollY > 200) {
      btn.classList.add('show');
      btn.classList.remove('hide');
    } else {
      btn.classList.remove('show');
      btn.classList.add('hide');
    }
  }
  // 最下部スクロール判定
  const logo = document.getElementById('kutsuzawa-logo');
  if (logo) {
    const scrollBottom = window.innerHeight + window.scrollY;
    const docHeight = document.documentElement.scrollHeight;
    if (docHeight - scrollBottom < 10) {
      logo.classList.add('show');
    } else {
      logo.classList.remove('show');
    }
  }
});
document.getElementById('scrollTopBtn').onclick = () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
