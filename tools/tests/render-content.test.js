'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { before, test } = require('node:test');
const Hexo = require('hexo');
const cheerio = require('cheerio');

const root = path.resolve(__dirname, '../..');
let site;

before(async () => {
  site = new Hexo(root, { silent: true });
  await site.init();
});

async function render(content) {
  const result = await site.post.render(null, { content, engine: 'md' });
  return cheerio.load(result.content, {}, false);
}

function codeText($, figure) {
  return $(figure).find('.code .line').toArray().map(line => $(line).text()).join('\n')
    .replace(/\n+$/, '');
}

test('existing imported CMake and C code survives rendering byte for byte', async () => {
  const post = fs.readFileSync(path.join(root, 'source/_posts/2026-08-28-stm32cubemx+vscode记录-绿帽子玩家.md'), 'utf8');
  const body = post.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const original = cheerio.load(body, {}, false);
  const expected = original('pre code').toArray().map(el => original(el).text()
    .replace(/\r\n/g, '\n').replace(/\n+$/, ''));
  assert.equal(expected.length, 2);

  const $ = await render(body);
  const figures = $('figure.highlight').toArray();
  assert.equal(figures.length, 2);
  figures.forEach((figure, index) => assert.equal(codeText($, figure), expected[index]));
  assert.ok($('figure.highlight.cmake .comment').length > 0);
  assert.equal($('figure.highlight h1, figure.highlight h2, figure.highlight em').length, 0);
});

test('Markdown fences highlight CMake, Makefile, C, C++ and Bash', async () => {
  const samples = {
    cmake: '# comment\nset(CMAKE_BUILD_TYPE "Debug")',
    makefile: '.PHONY: hello\nhello:\n\t@echo "Hello, make!"',
    c: '#include <stdio.h>\nint main(void) { return 0; }',
    cpp: 'extern "C" { int add(int a, int b); }\nstd::string s = "hello";',
    bash: 'printf "%s\\n" "$HOME"\ncmake --build build'
  };
  for (const [language, code] of Object.entries(samples)) {
    const $ = await render(['```' + language, code, '```'].join('\n'));
    const figure = $('figure.highlight').first();
    assert.equal(figure.length, 1, language);
    assert.equal(codeText($, figure), code, language);
    assert.ok(figure.find('.line span').length > 0, language);
  }
});

test('imported HTML keeps entities, tabs and template syntax literal', async () => {
  const content = '<pre><code class="language-cpp">  // # heading\n\tconst char *s = "{{ value }} {% raw %}";\n  if (a &lt; b &amp;&amp; c &gt; d) {}\n</code></pre>';
  const $ = await render(content);
  assert.equal(codeText($, $('figure.highlight').first()),
    '  // # heading\n\tconst char *s = "{{ value }} {% raw %}";\n  if (a < b && c > d) {}');
});

test('HTML code examples inside Markdown fences are not reinterpreted', async () => {
  const code = '<pre><code class="language-cmake">\n# not a heading\n</code></pre>';
  const $ = await render(['```html', code, '```'].join('\n'));
  assert.equal($('figure.highlight').length, 1);
  assert.equal(codeText($, $('figure.highlight').first()), code);
  assert.equal($('h1').length, 0);
});

test('inline Markdown code keeps literal pre markup', async () => {
  const $ = await render('`<pre><code>x</code></pre>`');
  assert.equal($('figure.highlight').length, 0);
  assert.equal($('p > code').text(), '<pre><code>x</code></pre>');
});

test('four-space indented code keeps literal pre markup', async () => {
  const $ = await render('    <pre><code>x</code></pre>');
  assert.equal($('figure.highlight').length, 0);
  assert.equal($('pre > code').text().trimEnd(), '<pre><code>x</code></pre>');
});

test('HTML containers keep imported code highlighted at any indentation', async () => {
  for (const newline of ['\n', '\r\n']) {
    for (const indentation of ['  ', '    ', '\t']) {
      const content = ['<div>', `${indentation}<pre><code class="language-c">int x;</code></pre>`, '</div>']
        .join(newline);
      const $ = await render(content);
      assert.equal($('div > figure.highlight.c').length, 1, JSON.stringify({ newline, indentation }));
      assert.equal(codeText($, $('figure.highlight').first()), 'int x;');
    }
  }
});

test('imported pre elements can span blank lines in a surrounding HTML block', async () => {
  const code = 'int x;\n\n// keep this comment\nint y;';
  const $ = await render(`<div>\n    <pre><code class="language-c">${code}</code></pre>\n</div>`);
  assert.equal($('div > figure.highlight.c').length, 1);
  assert.equal(codeText($, $('figure.highlight').first()), code);
  assert.equal($('h1, p').length, 0);
});

test('indented code in Markdown containers keeps literal pre markup', async () => {
  for (const content of [
    '>     <pre><code>x</code></pre>',
    '- item\n\n      <pre><code>x</code></pre>'
  ]) {
    const $ = await render(content);
    assert.equal($('figure.highlight').length, 0, content);
    assert.equal($('pre > code').text().trimEnd(), '<pre><code>x</code></pre>');
  }
});

test('HTML examples in unhighlighted fences keep literal pre markup', async () => {
  const code = '<pre><code>x</code></pre>';
  const $ = await render(['```html highlight:false', code, '```'].join('\n'));
  assert.equal($('figure.highlight').length, 0);
  assert.equal($('pre code.language-html').text().trimEnd(), code);
});

test('container-scoped unhighlighted fences keep literal pre markup', async () => {
  const content = [
    '- ```html highlight:false',
    '  <pre><code>list example</code></pre>',
    '  ```',
    '',
    '  ```html highlight:false',
    '  <pre><code>indented fence example</code></pre>',
    '  ```',
    '',
    '> ```html highlight:false',
    '> <pre><code>quote example</code></pre>',
    '> ```'
  ].join('\n');
  const $ = await render(content);
  assert.equal($('figure.highlight').length, 0);
  assert.equal($('pre code').first().text().trimEnd(), '<pre><code>list example</code></pre>');
  assert.equal($('pre code').eq(1).text().trimEnd(), '<pre><code>indented fence example</code></pre>');
  assert.equal($('pre code').last().text().trimEnd(), '<pre><code>quote example</code></pre>');
});

test('Nunjucks expressions and string literals keep literal pre markup', async () => {
  const content = '{% set sample = "<pre><code>x</code></pre>" %}'
    + '{% if "<pre>" in sample %}yes{% else %}no{% endif %}';
  const $ = await render(content);
  assert.equal($.root().text().trim(), 'yes');
  assert.equal($('figure.highlight').length, 0);
});

test('HTML comments and script template literals are not rewritten', async () => {
  const content = [
    '<!-- <pre><code>comment example</code></pre> -->',
    '',
    '<script>const sample = `<pre><code>script example</code></pre>`;</script>'
  ].join('\n');
  const $ = await render(content);
  assert.equal($('figure.highlight').length, 0);
  assert.equal($('pre').length, 0);
  assert.equal($('script').text(), 'const sample = `<pre><code>script example</code></pre>`;');
});

test('raw-text elements end at their first closing tag despite same-name string literals', async () => {
  for (const name of ['script', 'style', 'textarea']) {
    const literal = `const tag = '<${name}>';`;
    const $ = await render(`<${name}>${literal}</${name}>\n\n<pre><code class="language-c">int x;</code></pre>`);
    assert.equal($(name).text(), literal);
    assert.equal($('figure.highlight.c').length, 1, name);
    assert.equal(codeText($, $('figure.highlight').first()), 'int x;');
  }
});

test('repeated HTML void tags do not cause repeated scans of the remaining document', t => {
  const count = 8000;
  const measure = tag => {
    const content = `<div>${tag.repeat(count)}<pre><code class="language-c">int x;</code></pre></div>`;
    const start = performance.now();
    const result = site.execFilterSync('before_post_render', { content }, { context: site });
    const elapsed = performance.now() - start;
    assert.match(result.content, /<figure class="highlight c">/);
    return elapsed;
  };
  const selfClosing = measure('<br/>');
  const voidTags = measure('<br>');
  t.diagnostic(`${count} tags: <br/> ${selfClosing.toFixed(1)} ms; <br> ${voidTags.toFixed(1)} ms`);
  // Allow ample scheduling/CI noise while catching the multi-second quadratic path.
  assert.ok(voidTags < Math.max(1500, selfClosing * 10), `void tags took ${voidTags.toFixed(1)} ms`);
});

test('non-code pre elements keep their links and inline markup', async () => {
  const $ = await render('<pre><a href="https://example.com">link</a></pre>');
  assert.equal($('figure.highlight').length, 0);
  assert.equal($('pre a').text(), 'link');
  assert.equal($('pre a').attr('href'), 'https://example.com');
});

test('unknown languages stay readable without changing punctuation', async () => {
  const $ = await render('<pre><code class="language-unknown-example"># example\n  "a" &lt; "b"\n</code></pre>');
  assert.equal(codeText($, $('figure.highlight').first()), '# example\n  "a" < "b"');
  assert.equal($('h1').length, 0);
});

test('inline and display formulas render with subscripts and fractions', async () => {
  const $ = await render(String.raw`轮速 $v_{left} = \frac{s_1}{\Delta t}$。

$$
\omega_z = \frac{v_R - v_L}{b}
$$`);
  assert.equal($('.katex').length, 2);
  assert.equal($('.katex-display').length, 1);
  assert.equal($('.katex-error').length, 0);
  assert.equal($('annotation').last().text().trim(), String.raw`\omega_z = \frac{v_R - v_L}{b}`);
});

test('dollars in code and escaped dollar signs are not formulas', async () => {
  const $ = await render('价格 \\$5。`$HOME`\n\n```bash\necho "$HOME"\n```');
  assert.equal($('.katex').length, 0);
  assert.equal(codeText($, $('figure.highlight').first()), 'echo "$HOME"');
});

test('headings, tables, links and imported HTML still render', async () => {
  const $ = await render('# 标题\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[链接](https://example.com)\n\n<p><strong>已有正文</strong></p>');
  assert.equal($('h1').text(), '标题');
  assert.equal($('table tbody td').length, 2);
  assert.equal($('a').attr('href'), 'https://example.com');
  assert.equal($('p strong').text(), '已有正文');
});
