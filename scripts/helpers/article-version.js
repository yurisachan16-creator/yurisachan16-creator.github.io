const { normalizeArticleVersionMeta } = require('../../lib/article-version')

hexo.extend.helper.register('article_version_meta', function (page) {
  return normalizeArticleVersionMeta(page)
})
