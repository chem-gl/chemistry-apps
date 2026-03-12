#python
# -*- coding: utf-8 -*-
from read_log_gaussian import *
def main():
    x  = read_log_gaussian(filename="frequencies.log")
    estructura:Estructura = x.Estructuras[0]
    print(x)
 

if __name__ == "__main__":
    main()