
#python
# -*- coding: utf-8 -*-
from pathlib import Path
print('Running' if __name__ == '__main__' else 'Importing', Path(__file__).resolve())
import unittest
import read_log_gaussian


class Test(unittest.TestCase):
    def test_sum(self):
        pass

if __name__ == "__main__":
    unittest.main()