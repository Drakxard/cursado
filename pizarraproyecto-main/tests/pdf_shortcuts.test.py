import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from reconocimiento_local.visual_objects import validate_visual_content


class PdfShortcutValidation(unittest.TestCase):
    def setUp(self):
        self.shortcut = {'id': 'pdf-one', 'visualType': 'pdf-shortcut', 'kind': 'rounded',
                         'x': 10, 'y': 20, 'width': 250, 'height': 54, 'color': '#2563eb', 'strokeWidth': 1.5,
                         'label': 'Guía', 'pdfPinned': True,
                         'pdfReference': {'materialId': 41, 'subjectId': 'calculo3', 'fileName': 'Guía.PDF',
                                          'workspaceFileId': 'workspace://teoria/guia.pdf'}}

    def test_pinned_and_legacy_shortcuts_save_without_rewriting_the_reference(self):
        for pinned in (None, False, True):
            item = copy.deepcopy(self.shortcut)
            if pinned is None:
                item.pop('pdfPinned')
            else:
                item['pdfPinned'] = pinned
            before = copy.deepcopy(item)
            validate_visual_content({'shapes': [item]})
            self.assertEqual(item, before)

    def test_rejects_invalid_pin_states_and_pdf_references(self):
        for key, value in [('pdfPinned', 'true'), ('materialId', True), ('materialId', -1),
                           ('fileName', 'archivo.exe'), ('subjectId', ''),
                           ('workspaceFileId', 'workspace://../guia.pdf'),
                           ('workspaceFileId', 'workspace://teoria\\guia.pdf')]:
            with self.subTest(key=key, value=value):
                item = copy.deepcopy(self.shortcut)
                if key == 'pdfPinned':
                    item[key] = value
                else:
                    item['pdfReference'][key] = value
                with self.assertRaises(HTTPException):
                    validate_visual_content({'shapes': [item]})


if __name__ == '__main__':
    unittest.main()
