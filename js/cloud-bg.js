/* ============================================
   🌸 动态云朵背景 JavaScript
   根据页面类型添加不同的主题 class
   ============================================ */

(function() {
  'use strict';
  
  // 创建云朵背景容器
  function createCloudBg() {
    // 如果已存在则不重复创建
    if (document.getElementById('cloud-bg')) return;
    
    const cloudBg = document.createElement('div');
    cloudBg.id = 'cloud-bg';
    cloudBg.innerHTML = `
      <div class="bg-layer"></div>
      <div class="far-cloud"></div>
      <div class="near-cloud"></div>
    `;
    
    // 插入到 body 的最前面
    document.body.insertBefore(cloudBg, document.body.firstChild);
  }
  
  // 检测页面类型并添加对应的 class
  function detectPageType() {
    const path = window.location.pathname;
    const body = document.body;
    
    // 移除所有页面类型 class
    body.classList.remove(
      'page-type-home',
      'page-type-archive',
      'page-type-tag',
      'page-type-category',
      'page-type-about',
      'page-type-post'
    );
    
    // 根据 URL 路径判断页面类型
    if (path === '/' || path === '/index.html') {
      body.classList.add('page-type-home');
    } else if (path.includes('/archives')) {
      body.classList.add('page-type-archive');
    } else if (path.includes('/tags')) {
      body.classList.add('page-type-tag');
    } else if (path.includes('/categories')) {
      body.classList.add('page-type-category');
    } else if (path.includes('/about')) {
      body.classList.add('page-type-about');
    } else if (path.match(/\/\d{4}\/\d{2}\/\d{2}\//)) {
      // 文章页面路径格式: /2025/11/26/post-name/
      body.classList.add('page-type-post');
    } else {
      // 默认使用首页主题
      body.classList.add('page-type-home');
    }
  }
  
  // 初始化函数
  function init() {
    createCloudBg();
    detectPageType();
  }
  
  // DOM 加载完成后执行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // PJAX 支持 - 页面切换时重新检测
  document.addEventListener('pjax:complete', function() {
    detectPageType();
  });
  
  // 监听 Butterfly 主题的页面切换事件
  if (typeof btf !== 'undefined') {
    document.addEventListener('pjax:success', function() {
      detectPageType();
    });
  }
})();
