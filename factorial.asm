cbw
cwde
mov edx, 1
mov ecx, 1
cmp eax, 0 
je A
mov ecx, eax
A:
abc:
imul edx, ecx
LOOP abc
