#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
int main()
{
    int m,l;
    scanf("%d", &m);
    char a[32];
    char b[32];
    scanf("%s", a);
    if(a[0] == '0') {
        printf("0");
        return 0;
    }
    int i;
    for(i = 0; i < (int)strlen(a); i++) {
        if(a[i] > 64)
            a[i] -= 7;
    }
    scanf("%d", &l);
    char k;
    for(i = 0; i < (int)strlen(a) / 2; i++) {
        k = a[i];
        a[i] = a[strlen(a) - 1 - i];
        a[strlen(a) - 1 - i] = k;
    }
    unsigned long long n = 0;
    for(i = 0; i < (int)strlen(a); i++) {
        n += (a[i] - 48) * pow(m, i);
    }
    i = 0;
    while(n != 0) {
        b[i] = (n % l) + '0';
        n /= l;
        i++;
    }
    n = i;
    for(i = 0; i < (int)n / 2; i++) {
        k = b[i];
        b[i] = b[n - 1 - i];
        b[n - 1 - i] = k;
    }
    for(i = 0; i < (int)n; i++) {
        if(b[i] > 57)
            b[i] += 7;
        printf("%c", b[i]);
    }
    return 0;
}
