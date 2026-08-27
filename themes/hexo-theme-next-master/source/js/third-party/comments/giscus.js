/* global NexT, CONFIG */

document.addEventListener('page:loaded', async () => {
  if (!CONFIG.page.comments) return;

  await NexT.utils.loadComments('.giscus-container');
  await NexT.utils.getScript('https://giscus.app/client.js', {
    attributes: {
      async       : true,
      crossOrigin : 'anonymous',
      dataset     : {
        repo              : CONFIG.giscus.repo,
        repoId            : CONFIG.giscus.repo_id,
        category          : CONFIG.giscus.category,
        categoryId        : CONFIG.giscus.category_id,
        mapping           : CONFIG.giscus.mapping,
        strict            : CONFIG.giscus.strict ? '1' : '0',
        reactionsEnabled  : CONFIG.giscus.reactions_enabled ? '1' : '0',
        emitMetadata      : CONFIG.giscus.emit_metadata ? '1' : '0',
        inputPosition     : CONFIG.giscus.input_position,
        theme             : CONFIG.giscus.theme,
        lang              : CONFIG.giscus.language,
        loading           : CONFIG.giscus.loading
      }
    },
    parentNode: document.querySelector('.giscus')
  });
});
