"""Run with python3 -m unittest discover -s tests -v (no browser needed)."""
from html.parser import HTMLParser
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.nodes = []
        self.feed(path.read_text())

    def handle_starttag(self, tag, attrs):
        self.nodes.append((tag, dict(attrs)))


class SiteChecks(unittest.TestCase):
    def test_accessibility_targets_and_references(self):
        for path in ROOT.glob('*.html'):
            with self.subTest(page=path.name):
                nodes = Page(path).nodes
                ids = [attrs['id'] for _, attrs in nodes if 'id' in attrs]
                self.assertEqual(len(ids), len(set(ids)), 'duplicate IDs')
                main = [a for t, a in nodes if t == 'main']
                self.assertEqual(len(main), 1)
                self.assertEqual(main[0]['id'], 'main')
                self.assertEqual(main[0]['tabindex'], '-1')
                self.assertTrue(any(t == 'a' and a.get('class') == 'skip-link'
                                    and a.get('href') == '#main' for t, a in nodes))
                for tag, attrs in nodes:
                    for key in ('aria-labelledby', 'aria-describedby', 'aria-controls', 'headers'):
                        for target in attrs.get(key, '').split():
                            self.assertIn(target, ids, f'missing {key} target')
                    href = attrs.get('href', '')
                    if href.startswith('#'):
                        self.assertIn(href[1:], ids)
                    if tag == 'th':
                        self.assertEqual(attrs.get('scope'), 'col')

    def test_demo_survives_script_failure(self):
        nodes = Page(ROOT / 'index.html').nodes
        by_id = {a['id']: (t, a) for t, a in nodes if 'id' in a}
        for name in ('sw', 'ask', 'rec'):
            self.assertIn('hidden', by_id[name][1])
        self.assertNotIn('hidden', by_id['static-example'][1])
        self.assertNotIn('aria-hidden', by_id['records'][1])
        self.assertEqual(by_id['bench'][1]['data-asked'], '1')
        self.assertEqual(by_id['bench'][1]['data-open'], '1')
        self.assertFalse(any(t == 'noscript' for t, a in nodes))
        self.assertEqual(by_id['answer-status'][1]['role'], 'status')
        self.assertEqual(by_id['ask'][1]['aria-describedby'], 'sample-question')
        scripts = [a for t, a in nodes if t == 'script']
        self.assertEqual(len(scripts), 2)
        self.assertNotIn('src', scripts[0])
        self.assertEqual(scripts[1]['src'], 'site.js')
        self.assertIn('defer', scripts[1])

    def test_static_example_hidden_before_deferred_script(self):
        html = (ROOT / 'index.html').read_text()
        early_script = "<script>document.documentElement.className='js';</script>"
        hidden_style = '<style>.js #static-example { display: none; }</style>'
        self.assertIn(early_script, html)
        self.assertIn(hidden_style, html)
        self.assertLess(html.index(early_script), html.index('</head>'))
        self.assertLess(html.index(hidden_style), html.index('</head>'))
        self.assertLess(html.index(early_script), html.index('<script src="site.js"'))

    def test_local_assets_exist(self):
        for path in ROOT.glob('*.html'):
            for tag, attrs in Page(path).nodes:
                for attr in ('href', 'src'):
                    value = attrs.get(attr, '')
                    if not value or value.startswith(('#', 'mailto:', 'https:', 'http:')):
                        continue
                    self.assertTrue((ROOT / value.lstrip('/')).exists(), value)


if __name__ == '__main__':
    unittest.main()
