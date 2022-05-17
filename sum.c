#include <stdio.h>
#include <string.h>
#include <stdlib.h>

double my_pow (double a, double b) {
    int i = 0;
    double d = a;
    double c = a;
    if(b == 0)
        return 1;
    if(b < 0) {
        for (i = (-1) * b; i >= 0; i--) {
            d /= c;
        }
        return d;
    }
    else
        for (i = 1; i < b; i++) {
            d *= c;
        }
    return d;
}

int main(int argc, char * argv[]) {
    char *c = argv[1];
    long long b;
    double a;
    int i = 0;
    scanf("%lf", &a);
    scanf("%llx", &b);
    
    a += b;
    
    for(i = 0; i < (int)strlen(c); i++) {
        if(c[i] > 64)
            c[i] -= 7;
    }
    
    for(i = 0; i < (int)strlen(c); i++) {
        a += (c[i] - 48) * my_pow(27, (int)strlen(c) - i - 1);
    }
    
    printf("%.3lf\n", a);
    
    return 0;
    argc++;
}
