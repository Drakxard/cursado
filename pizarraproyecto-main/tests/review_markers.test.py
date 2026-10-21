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

    def test_saved_view_and_linked_shapes(self):
        base={'id':'one','kind':'rounded','x':0,'y':0,'width':160,'height':54,'strokeWidth':1.5,'color':'#202020'}
        marker={**base,'visualType':'review-marker','reviewView':{'center':{'x':100,'y':200},'zoom':1.7}}
        validate_visual_content({'shapes':[marker]})
        for view in [None,{}, {'center':{'x':float('nan'),'y':2},'zoom':1}, {'center':{'x':1,'y':2},'zoom':0}]:
            with self.assertRaises(HTTPException):validate_visual_content({'shapes':[{**marker,'reviewView':view}]})
        validate_visual_content({'shapes':[{**base,'visualType':'important-countdown','importantTaskId':'exam'}]})
        validate_visual_content({'shapes':[{**base,'visualType':'board-shortcut','boardReference':{'boardId':'local:two','name':'Otra'}}]})
        for kind in ['important-countdown','board-shortcut']:
            with self.assertRaises(HTTPException):validate_visual_content({'shapes':[{**base,'visualType':kind}]})

if __name__=='__main__':unittest.main()
