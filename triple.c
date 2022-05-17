#include <stdio.h>

long long my_pow(unsigned long long a, unsigned long long b) {
    if(b == 0)
        return 1;
    unsigned long long i = 1;
    unsigned long long c = a;
    for(i = 1; i < b; i++) {
        a *= c;
    }
    return a;
}

int main()
{
    unsigned long long a;
    scanf("%llu", &a);
    unsigned long long b = a;
    unsigned long long len = 1, clen = 1;
    while(b > 0) {
        if(b / 10 != 0) {
            len += 1;
        }
        b /= 10;
    }
    clen = len;
    unsigned long long i = 0;
    b = 0;
    for(i = 0; i < clen; i++) {
        len -= 1;
        b += ((a / my_pow(10, len)) % 10) * my_pow(3, len);
    }
    printf("%llu\n", b);
    return 0;
}
