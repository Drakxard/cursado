import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from reconocimiento_local.visual_objects import validate_visual_content

class ReviewMarkerValidation(unittest.TestCase):
    def test_marker_persists_without_rewriting(self):
        marker={'id':'review-one','kind':'circle','visualType':'review-marker','x':100,'y':200,'width':56,'height':56,'strokeWidth':3.5,'color':'#202020'}
        before=copy.deepcopy(marker)
        validate_visual_content({'shapes':[marker]})
        self.assertEqual(marker,before)
        with self.assertRaises(HTTPException):
            validate_visual_content({'shapes':[marker,copy.deepcopy(marker)]})
        marker['width']=-1
        with self.assertRaises(HTTPException):
            validate_visual_content({'shapes':[marker]})

if __name__=='__main__':unittest.main()
