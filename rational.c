#include <stdio.h>
#include <math.h>

int main()
{
    char a[1000];
    int i = 0, p = 0, l = 0, q = 0, k = 0;
    scanf("%s", a);
    while(a[l] != '\0') {
        if(a[l] != '.') {
            p++;
        }
        if(a[l] == '.')
            q = p;
        l++;
    }
    if(p == l) {
        q = p;
    }
    double d = 0;
    for(i = 0; i < l; i++) {
        if(a[i] == '.') {
            continue;
        }
        d += (a[i] - 48) * pow(2, q - k - 1);
        k++;
    }
    printf("%.12lf", d);
    
    return 0;
}
