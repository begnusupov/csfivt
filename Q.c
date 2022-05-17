#include <stdio.h>
int main()
{
    long long n;
    scanf("%lld", &n);
    long long m = n * n * n, i;
    for(i = m - 1; i > 0; i--) {
        if(i * i % m == i) {
            m = i;
            i = 0;
        }
        else
            n = n;
    }
    printf("%lld\n", m);
    return 0;
}
