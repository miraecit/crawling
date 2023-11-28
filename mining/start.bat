
@echo off
start /B node copper.js
timeout /t 1 /nobreak

start /B node gold.js
timeout /t 1 /nobreak


start /B node lithum.js
timeout /t 1 /nobreak


start /B node nickel.js
timeout /t 1 /nobreak


start /B node silver.js
timeout /t 1 /nobreak
